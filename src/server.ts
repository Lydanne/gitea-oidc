import fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';

const app = fastify({ logger: true });

// 配置JWT
app.register(jwt, { secret: 'your-secret-key' }); // 在生产中用环境变量

app.register(cors, { origin: true });

// 硬编码用户数据（仅用于演示）
const users = [
  { id: '1', username: 'testuser', email: 'test@example.com', password: 'password' }
];

// 发现端点
app.get('/.well-known/openid_configuration', async (request, reply) => {
  const baseUrl = `${request.protocol}://${request.hostname}`;
  reply.send({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    userinfo_endpoint: `${baseUrl}/userinfo`,
    jwks_uri: `${baseUrl}/jwks`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    scopes_supported: ['openid', 'profile', 'email'],
    token_endpoint_auth_methods_supported: ['client_secret_basic'],
    claims_supported: ['sub', 'iss', 'aud', 'exp', 'iat', 'email', 'name']
  });
});

// 授权端点 (简化版，假设用户已登录)
app.get('/authorize', async (request, reply) => {
  const { response_type, client_id, redirect_uri, state, scope } = request.query as any;

  if (response_type !== 'code') {
    return reply.code(400).send({ error: 'unsupported_response_type' });
  }

  // 简化：假设用户是testuser
  const user = users[0];

  // 生成授权码（实际应存储在数据库）
  const code = app.jwt.sign({ sub: user.id, client_id, redirect_uri }, { expiresIn: '10m' });

  const redirectUrl = `${redirect_uri}?code=${code}&state=${state || ''}`;
  reply.redirect(redirectUrl);
});

// 令牌端点
app.post('/token', async (request, reply) => {
  const { grant_type, code, redirect_uri, client_id, client_secret } = request.body as any;

  if (grant_type !== 'authorization_code') {
    return reply.code(400).send({ error: 'unsupported_grant_type' });
  }

  try {
    const decoded = app.jwt.verify(code) as any;
    if (decoded.client_id !== client_id) {
      return reply.code(400).send({ error: 'invalid_client' });
    }

    const user = users.find(u => u.id === decoded.sub);
    if (!user) {
      return reply.code(400).send({ error: 'invalid_grant' });
    }

    const accessToken = app.jwt.sign({ sub: user.id, scope: 'openid profile email' }, { expiresIn: '1h' });
    const idToken = app.jwt.sign({
      iss: `${request.protocol}://${request.hostname}`,
      sub: user.id,
      aud: client_id,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      email: user.email,
      name: user.username
    }, { expiresIn: '1h' });

    reply.send({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      id_token: idToken
    });
  } catch (err) {
    reply.code(400).send({ error: 'invalid_grant' });
  }
});

// 用户信息端点
app.get('/userinfo', async (request, reply) => {
  try {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'invalid_token' });
    }

    const token = authHeader.substring(7);
    const decoded = app.jwt.verify(token) as any;

    const user = users.find(u => u.id === decoded.sub);
    if (!user) {
      return reply.code(401).send({ error: 'invalid_token' });
    }

    reply.send({
      sub: user.id,
      email: user.email,
      name: user.username,
      preferred_username: user.username
    });
  } catch (err) {
    reply.code(401).send({ error: 'invalid_token' });
  }
});

// JWKS端点（简化，实际应提供公钥）
app.get('/jwks', async (request, reply) => {
  reply.send({ keys: [] }); // 简化版
});

const start = async () => {
  try {
    await app.listen({ port: 3000, host: '0.0.0.0' });
    console.log('OIDC IdP server listening on http://localhost:3000');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
