const env = import.meta.env;
export const config = {
  apiUrl: (env.VITE_API_URL as string | undefined) ?? "http://localhost:3100",
  oidcIssuer: (env.VITE_OIDC_ISSUER as string | undefined) ?? "http://localhost:8081/realms/office",
  oidcClientId: (env.VITE_OIDC_CLIENT_ID as string | undefined) ?? "office-web",
};
