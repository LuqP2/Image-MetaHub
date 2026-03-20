import http from 'http';
import { URL } from 'url';
import {
  activateLicenseForDevice,
  buildEntitlement,
  deactivateActivation,
  deactivateLicenseDevice,
  ensureKeypair,
  findActivationByIdentity,
  findLicenseByEmailAndKey,
  getLicenseById,
  listLicenseDevices,
  normalizeEmail,
  refreshActivation,
  signEntitlement,
  startTrial,
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

      const license = await findLicenseByEmailAndKey(email, licenseKey);

      if (!license) {
        return sendJson(res, 401, { error: 'invalid_license' });
      }

      let activation;
      try {
        activation = await activateLicenseForDevice({ license, deviceId, deviceLabel });
      } catch (error) {
        if (error.message === 'device_limit_reached') {
          return sendJson(res, 409, { error: 'device_limit_reached' });
        }
        throw error;
      }

      const entitlement = signEntitlement(buildEntitlement({ license, activation }), privateKeyPem);
      return sendJson(res, 200, { success: true, entitlement });
    }

    if (req.method === 'POST' && url.pathname === '/v1/licenses/refresh') {
      const body = await readBody(req);
      const activation = await refreshActivation({
        activationId: body.activationId,
        licenseId: body.licenseId,
        deviceId: body.deviceId,
      });

      if (!activation) {
        return sendJson(res, 404, { error: 'activation_not_found' });
      }

      const license = await getLicenseById(activation.licenseId);
      if (!license) {
        return sendJson(res, 404, { error: 'license_not_found' });
      }

      const entitlement = signEntitlement(buildEntitlement({ license, activation }), privateKeyPem);
      return sendJson(res, 200, { success: true, entitlement });
    }

    if (req.method === 'POST' && url.pathname === '/v1/licenses/deactivate') {
      const body = await readBody(req);
      const activation = await deactivateActivation({
        activationId: body.activationId,
        licenseId: body.licenseId,
        deviceId: body.deviceId,
      });

      if (!activation || activation.status !== 'deactivated') {
        return sendJson(res, 404, { error: 'activation_not_found' });
      }

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

      let trial;
      try {
        trial = await startTrial({ email, deviceId });
      } catch (error) {
        if (error.message === 'trial_already_used') {
          return sendJson(res, 409, { error: 'trial_already_used' });
        }
        throw error;
      }

      const activation = {
        activationId: `trial-act-${trial.trialId}`,
        licenseId: trial.trialId,
        deviceId,
        deviceLabel: deviceLabel || 'Unknown Device',
      };
      const entitlement = signEntitlement(buildEntitlement({ activation, trial }), privateKeyPem);
      return sendJson(res, 200, { success: true, entitlement });
    }

    if (req.method === 'POST' && url.pathname === '/v1/licenses/devices/list') {
      const body = await readBody(req);
      const email = normalizeEmail(body.email);
      const licenseKey = String(body.licenseKey || '').trim().toUpperCase();
      const license = await findLicenseByEmailAndKey(email, licenseKey);

      if (!license) {
        return sendJson(res, 401, { error: 'invalid_license' });
      }

      const devices = await listLicenseDevices({ licenseId: license.licenseId });
      return sendJson(res, 200, { success: true, devices, licenseId: license.licenseId, maxDevices: license.maxDevices });
    }

    if (req.method === 'POST' && url.pathname === '/v1/licenses/devices/deactivate') {
      const body = await readBody(req);
      const email = normalizeEmail(body.email);
      const licenseKey = String(body.licenseKey || '').trim().toUpperCase();
      const activationId = String(body.activationId || '').trim();
      const license = await findLicenseByEmailAndKey(email, licenseKey);

      if (!license) {
        return sendJson(res, 401, { error: 'invalid_license' });
      }

      const activation = await deactivateLicenseDevice({ licenseId: license.licenseId, activationId });
      if (!activation || activation.status !== 'deactivated') {
        return sendJson(res, 404, { error: 'activation_not_found' });
      }

      return sendJson(res, 200, { success: true, activation });
    }

    return sendJson(res, 404, { error: 'not_found' });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || 'internal_error' });
  }
});

server.listen(PORT, () => {
  console.log(`[IMH] License server listening on http://127.0.0.1:${PORT}`);
});
