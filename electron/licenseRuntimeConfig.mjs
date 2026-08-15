export function resolveLicenseRuntimeConfig({ isPackaged, env = process.env, bakedConfig }) {
  const allowDevelopmentOverrides = isPackaged === false;
  return {
    serverUrl: allowDevelopmentOverrides && env.IMH_LICENSE_SERVER_URL
      ? env.IMH_LICENSE_SERVER_URL
      : bakedConfig.serverUrl,
    publicKey: allowDevelopmentOverrides && env.IMH_LICENSE_PUBLIC_KEY
      ? env.IMH_LICENSE_PUBLIC_KEY
      : bakedConfig.publicKey,
  };
}
