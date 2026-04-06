import "fastify";
import { AppContext } from "../../shared/appContext";
import { DashboardSession } from "./session";

declare module "fastify" {
  interface FastifyRequest {
    session: DashboardSession | null;
  }

  interface FastifyInstance {
    appContext: AppContext;
  }
}