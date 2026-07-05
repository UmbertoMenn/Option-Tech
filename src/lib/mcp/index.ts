import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listPortfoliosTool from "./tools/list-portfolios";
import getPortfolioPositionsTool from "./tools/get-portfolio-positions";
import listDerivativeStrategiesTool from "./tools/list-derivative-strategies";

// Issuer OAuth: hostname diretto Supabase (mai proxy .lovable.cloud).
// Costruito dal project ref inlined a build-time da Vite, resta import-safe.
const projectRef =
  import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "option-tech-mcp",
  title: "Option Tech MCP",
  version: "0.1.0",
  instructions:
    "Strumenti in sola lettura per accedere ai portafogli Option Tech dell'utente autenticato: elenco portafogli, posizioni per portafoglio e configurazioni di strategie derivati.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    listPortfoliosTool,
    getPortfolioPositionsTool,
    listDerivativeStrategiesTool,
  ],
});
