#!/usr/bin/env node

import { runCli } from "./cli.js";
import { createNodeDependencies } from "./nodeDependencies.js";

process.exitCode = await runCli(process.argv.slice(2), createNodeDependencies());
