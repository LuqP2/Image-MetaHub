import http from 'http';
import crypto from 'crypto';
import { URL } from 'url';
import {
  buildEntitlement,
  createActivation,
  ensureKeypair,
  loadDb,
  normalizeEmail,
  saveDb,
  signEntitlement,
} from './lib.mjs';

const PORT = Number(process.env.IMH_LICENSE_SERVER_PORT || 8787);

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(JSON.stringify(payload));
}

function findActiveActivation(db, licenseId, deviceId) {
  return db.activations.find((activation) =>
    activation.licenseId === licenseId &&
    activation.deviceId === deviceId &&
    activation.status === 'active'
  );
}

function countActiveActivations(db, licenseId) {
  return db.activations.filter((activation) => activation.licenseId === licenseId && activation.status === 'active').length;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    return sendJson(res, 404, { error: 'not_found' });
  }

  if (req.method === 'OPTIONS') {
    return sendJson(res, 204, {});
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const { privateKeyPem, publicKeyPem } = await ensureKeypair();

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, publicKeyPem });
  }

  try {
    if (req.method === 'POST' && url.pathname === '/v1/licenses/activate') {
      const body = await readBody(req);
      const email = normalizeEmail(body.email);
      const licenseKey = String(body.licenseKey || '').trim().toUpperCase();
      const deviceId = String(body.deviceId || '').trim();
      const deviceLabel = String(body.deviceLabel || '').trim();

      if (!email || !licenseKey || !deviceId) {
        return sendJson(res, 400, { error: 'email, licenseKey, and deviceId are required' });
      }

      const db = await loadDb();
      const license = db.licenses.find((item) =>
        item.email === email &&
        item.licenseKey === licenseKey &&
        item.status !== 'revoked'
      );

      if (!license) {
        return sendJson(res, 401, { error: 'invalid_license' });
      }

      let activation = findActiveActivation(db, license.licenseId, deviceId);
      if (!activation) {
        const activeCount = countActiveActivations(db, license.licenseId);
        if (activeCount >= license.maxDevices) {
          return sendJson(res, 409, { error: 'device_limit_reached' });
        }
        activation = createActivation({ licenseId: license.licenseId, deviceId, deviceLabel });
        db.activations.push(activation);
      } else {
        activation.lastValidatedAt = new Date().toISOString();
        activation.deviceLabel = deviceLabel || activation.deviceLabel;
      }

      await saveDb(db);
      const entitlement = signEntitlement(buildEntitlement({ license, activation }), privateKeyPem);
      return sendJson(res, 200, { success: true, entitlement });
    }

    if (req.method === 'POST' && url.pathname === '/v1/licenses/refresh') {
      const body = await readBody(req);
      const db = await loadDb();
      const activation = db.activations.find((item) =>
        item.activationId === body.activationId &&
        item.licenseId === body.licenseId &&
        item.deviceId === body.deviceId &&
        item.status === 'active'
      );

      if (!activation) {
        return sendJson(res, 404, { error: 'activation_not_found' });
      }

      const license = db.licenses.find((item) => item.licenseId === activation.licenseId);
      if (!license) {
        return sendJson(res, 404, { error: 'license_not_found' });
      }

      activation.lastValidatedAt = new Date().toISOString();
      await saveDb(db);

      const entitlement = signEntitlement(buildEntitlement({ license, activation }), privateKeyPem);
      return sendJson(res, 200, { success: true, entitlement });
    }

    if (req.method === 'POST' && url.pathname === '/v1/licenses/deactivate') {
      const body = await readBody(req);
      const db = await loadDb();
      const activation = db.activations.find((item) =>
        item.activationId === body.activationId &&
        item.licenseId === body.licenseId &&
        item.deviceId === body.deviceId &&
        item.status === 'active'
      );

      if (!activation) {
        return sendJson(res, 404, { error: 'activation_not_found' });
      }

      activation.status = 'deactivated';
      activation.deactivatedAt = new Date().toISOString();
      await saveDb(db);
      return sendJson(res, 200, { success: true });
    }

    if (req.method === 'POST' && url.pathname === '/v1/trials/start') {
      const body = await readBody(req);
      const deviceId = String(body.deviceId || '').trim();
      const deviceLabel = String(body.deviceLabel || '').trim();
      const email = body.email ? normalizeEmail(body.email) : null;

      if (!deviceId) {
        return sendJson(res, 400, { error: 'deviceId is required' });
      }

      const db = await loadDb();
      const hasExistingTrial = db.trials.some((trial) =>
        trial.deviceId === deviceId || (email && trial.email && trial.email === email)
      );

      if (hasExistingTrial) {
        return sendJson(res, 409, { error: 'trial_already_used' });
      }

      const trial = {
        trialId: `trial-${crypto.randomUUID()}`,
        email,
        deviceId,
        status: 'active',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      };
      const activation = createActivation({ licenseId: trial.trialId, deviceId, deviceLabel });
      db.trials.push(trial);
      db.activations.push(activation);
      await saveDb(db);

      const entitlement = signEntitlement(buildEntitlement({ activation, trial }), privateKeyPem);
      return sendJson(res, 200, { success: true, entitlement });
    }

    return sendJson(res, 404, { error: 'not_found' });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || 'internal_error' });
  }
});

server.listen(PORT, () => {
  console.log(`[IMH] License server listening on http://127.0.0.1:${PORT}`);
});
