import { defineRailway, postgres, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const Postgres = postgres("Postgres", { region: "iad" });
  Postgres.deploy = { multiRegionConfig: { iad: { numReplicas: 1 } } };
  Postgres.networking = { privateNetworkEndpoint: "postgres" };
  const postgresVolume = volume("postgres-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "iad", sizeMB: 500 });
  // Express API. Built from the repo root so the SQL migrations ship in the image; they run before each deploy.
  const travelsphereApi = service("travelsphere-api", {
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "server/Dockerfile" },
    deploy: {
      preDeployCommand: ["node dist/migrate.js --local"],
      healthcheckPath: "/api/health",
      restartPolicyType: "ON_FAILURE",
    },
    replicas: { "iad": 1 },
  });
  // Risk service (deployed with `railway up risk-service --path-as-root`). One replica: it runs the scheduler.
  const travelsphereRisk = service("travelsphere-risk", {
    build: { buildEnvironment: "V3", builder: "RAILPACK" },
    deploy: {
      startCommand: "uvicorn app.main:app --host :: --port 8001",
      // No Railway healthcheck: the scheduler's first reassessment run occupies the DB pool and /health times out.
      // The API reports this service's health at /api/health.
      restartPolicyType: "ON_FAILURE",
    },
    replicas: { "iad": 1 },
  });

  return project("travelsphere", {
    variables: { managed: false },
    resources: [travelsphereApi, Postgres, travelsphereRisk, postgresVolume],
  });
});
