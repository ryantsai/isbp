-- Runs once, when the dev Postgres volume is first initialised (docker-compose.dev.yml).
-- `isbp_test` is the throwaway database used by `pnpm test:integration`
-- (DATABASE_URL=postgres://isbp:isbp@localhost:5432/isbp_test), matching `pnpm dev:services`.
CREATE DATABASE isbp_test OWNER isbp;
