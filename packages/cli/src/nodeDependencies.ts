import { execFile } from "node:child_process";
import { lookup } from "node:dns/promises";
import { constants } from "node:fs";
import { open, unlink } from "node:fs/promises";
import { request as httpRequest, type IncomingMessage, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { relative } from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { promisify } from "node:util";
import type {
  CliDependencies,
  CliFileSystem,
  CliTerminal,
  HttpClient,
  HttpResponse,
} from "./dependencies.js";

const execFileAsync = promisify(execFile);

const readFileHandle = async (filePath: string, maximumBytes: number, flags: number) => {
  const handle = await open(filePath, flags);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw Object.assign(new Error("not a regular file"), { code: "EINVAL" });
    }
    if (stat.size > maximumBytes) {
      throw Object.assign(new Error("file exceeds size limit"), { code: "EFBIG" });
    }
    const content = await handle.readFile({ encoding: "utf8" });
    if (Buffer.byteLength(content, "utf8") > maximumBytes) {
      throw Object.assign(new Error("file exceeds size limit"), { code: "EFBIG" });
    }
    return {
      content,
      isFile: stat.isFile(),
      mode: stat.mode & 0o7777,
      uid: stat.uid,
    };
  } finally {
    await handle.close();
  }
};

export const createNodeFileSystem = (): CliFileSystem => ({
  supportsSecureSecretWrite: process.platform !== "win32",
  async readTextFile(filePath, maximumBytes) {
    return (await readFileHandle(filePath, maximumBytes, constants.O_RDONLY)).content;
  },
  readSecureTextFile(filePath, maximumBytes) {
    if (process.platform === "win32" || typeof constants.O_NOFOLLOW !== "number") {
      throw Object.assign(new Error("secure file primitives are unavailable"), {
        code: "ENOTSUP",
      });
    }
    return readFileHandle(filePath, maximumBytes, constants.O_RDONLY | constants.O_NOFOLLOW);
  },
  async writeTextFileExclusive(filePath, content, mode) {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let created = false;
    try {
      handle = await open(
        filePath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        mode,
      );
      created = true;
      await handle.writeFile(content, { encoding: "utf8" });
      await handle.chmod(mode);
      await handle.sync();
    } catch (error) {
      await handle?.close().catch(() => undefined);
      handle = undefined;
      if (created) {
        await unlink(filePath).catch(() => undefined);
      }
      throw error;
    } finally {
      await handle?.close();
    }
  },
});

const createResponseBodyReader = (response: Response) => {
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  const cancel = async () => {
    if (activeReader) {
      await activeReader.cancel();
      return;
    }
    await response.body?.cancel();
  };

  const readText = async (maximumBytes: number): Promise<string> => {
    if (!response.body) {
      return "";
    }

    const reader = response.body.getReader();
    activeReader = reader;
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        totalBytes += value.byteLength;
        if (totalBytes > maximumBytes) {
          await reader.cancel().catch(() => undefined);
          throw Object.assign(new Error("response exceeds size limit"), { code: "EFBIG" });
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
      if (activeReader === reader) {
        activeReader = undefined;
      }
    }
    return Buffer.concat(chunks, totalBytes).toString("utf8");
  };

  return { cancel, readText };
};

const createPinnedLookup = (addresses: readonly string[]): LookupFunction => {
  const records = addresses.map((address) => {
    const family = isIP(address);
    if (family !== 4 && family !== 6) {
      throw Object.assign(new Error(`invalid pinned IP address: ${address}`), { code: "EINVAL" });
    }
    return { address, family };
  });
  if (records.length === 0) {
    throw Object.assign(new Error("at least one pinned IP address is required"), {
      code: "EINVAL",
    });
  }

  return (hostname, options, callback) => {
    const requestedFamily =
      options.family === "IPv4" ? 4 : options.family === "IPv6" ? 6 : options.family;
    const candidates =
      requestedFamily === 4 || requestedFamily === 6
        ? records.filter(({ family }) => family === requestedFamily)
        : records;
    if (candidates.length === 0) {
      callback(
        Object.assign(new Error(`no pinned address matches ${hostname}`), { code: "ENOTFOUND" }),
        "",
        0,
      );
      return;
    }
    if (options.all) {
      callback(null, candidates);
      return;
    }
    callback(null, candidates[0].address, candidates[0].family);
  };
};

const createIncomingResponseBodyReader = (response: IncomingMessage) => ({
  async cancel() {
    response.destroy();
  },
  async readText(maximumBytes: number): Promise<string> {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of response) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.byteLength;
      if (totalBytes > maximumBytes) {
        response.destroy();
        throw Object.assign(new Error("response exceeds size limit"), { code: "EFBIG" });
      }
      chunks.push(buffer);
    }
    return Buffer.concat(chunks, totalBytes).toString("utf8");
  },
});

const fetchWithPinnedAddresses = async (
  url: string,
  init: Parameters<HttpClient["fetch"]>[1],
): Promise<HttpResponse> => {
  const pinnedAddresses = init.pinnedAddresses;
  if (pinnedAddresses === undefined) {
    throw new Error("pinned addresses are required");
  }

  const target = new URL(url);
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw Object.assign(new Error(`unsupported URL protocol: ${target.protocol}`), {
      code: "EPROTONOSUPPORT",
    });
  }

  const requestOptions: RequestOptions = {
    agent: false,
    headers: init.headers,
    lookup: createPinnedLookup(pinnedAddresses),
    method: "GET",
    signal: init.signal,
  };

  return await new Promise<HttpResponse>((resolve, reject) => {
    const handleResponse = (response: IncomingMessage) => {
      const bodyReader = createIncomingResponseBodyReader(response);
      const status = response.statusCode ?? 0;
      resolve({
        cancel: bodyReader.cancel,
        headers: {
          get(name) {
            const value = response.headers[name.toLowerCase()];
            return Array.isArray(value) ? value.join(", ") : (value ?? null);
          },
        },
        ok: status >= 200 && status < 300,
        readText: bodyReader.readText,
        status,
        url,
      });
    };
    const request =
      target.protocol === "https:"
        ? httpsRequest(target, requestOptions, handleResponse)
        : httpRequest(target, requestOptions, handleResponse);
    request.once("error", reject);
    request.end();
  });
};

const createNodeTerminal = (): CliTerminal => {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  return {
    interactive,
    async prompt(message) {
      const readline = createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
      });
      try {
        return await readline.question(message);
      } finally {
        readline.close();
      }
    },
    async promptHidden(message) {
      process.stdout.write(message);
      const mutedOutput = new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      });
      const readline = createInterface({
        input: process.stdin,
        output: mutedOutput,
        terminal: true,
      });
      try {
        return await readline.question("");
      } finally {
        readline.close();
        process.stdout.write("\n");
      }
    },
  };
};

export const createNodeDependencies = (): CliDependencies => ({
  cwd: process.cwd(),
  dnsResolver: {
    async resolve(hostname) {
      const addresses = await lookup(hostname, { all: true, verbatim: true });
      return addresses.map(({ address }) => address);
    },
  },
  fileSystem: createNodeFileSystem(),
  gitIgnoreChecker: {
    async isIgnored(cwd, filePath) {
      const relativePath = relative(cwd, filePath);
      try {
        await execFileAsync("git", ["-C", cwd, "ls-files", "--error-unmatch", "--", relativePath], {
          encoding: "utf8",
        });
        return false;
      } catch (error) {
        if (typeof error !== "object" || error === null || !("code" in error) || error.code !== 1) {
          throw error;
        }
      }
      try {
        await execFileAsync(
          "git",
          ["-C", cwd, "check-ignore", "--quiet", "--no-index", "--", relativePath],
          { encoding: "utf8" },
        );
        return true;
      } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === 1) {
          return false;
        }
        throw error;
      }
    },
  },
  httpClient: {
    async fetch(url, init) {
      const { pinnedAddresses, ...fetchInit } = init;
      if (pinnedAddresses !== undefined) {
        return fetchWithPinnedAddresses(url, init);
      }

      const response = await globalThis.fetch(url, fetchInit);
      const bodyReader = createResponseBodyReader(response);
      return {
        cancel: bodyReader.cancel,
        headers: response.headers,
        ok: response.ok,
        readText: bodyReader.readText,
        status: response.status,
        url: response.url,
      };
    },
  },
  now: () => new Date(),
  stderr: { write: (text) => process.stderr.write(text) },
  stdout: { write: (text) => process.stdout.write(text) },
  terminal: createNodeTerminal(),
  uid: process.getuid?.(),
});
