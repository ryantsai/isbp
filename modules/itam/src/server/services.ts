import type { ModuleContext } from '@isbp/sdk/server';
import { AssetService } from './assets';
import { CatalogService } from './catalog';
import { ContractService } from './contract-service';
import { DashboardService } from './dashboard';
import { LicenseService } from './licenses';

export interface Services {
  assets: AssetService;
  licenses: LicenseService;
  contracts: ContractService;
  catalog: CatalogService;
  dashboard: DashboardService;
}

const cache = new WeakMap<ModuleContext, Services>();

/** One set of services per module context (routes, tools, resolvers, events and jobs share them). */
export function services(ctx: ModuleContext): Services {
  let s = cache.get(ctx);
  if (!s) {
    const assets = new AssetService(ctx);
    const licenses = new LicenseService(ctx);
    const contracts = new ContractService(ctx);
    // Disposing of a device frees its seats: compliance follows in the same transaction.
    assets.onSeatsChanged = async (tx, licenseIds) => {
      await licenses.recomputeLicenses(tx, licenseIds);
    };
    s = {
      assets,
      licenses,
      contracts,
      catalog: new CatalogService(ctx, { contracts, licenses }),
      dashboard: new DashboardService(ctx, { contracts, licenses }),
    };
    cache.set(ctx, s);
  }
  return s;
}
