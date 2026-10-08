import type { ModuleContext } from '@isbp/sdk/server';
import { SharedAccountService } from './accounts';
import { AssetService } from './assets';
import { ReviewService } from './reviews';
import { StocktakeService } from './stocktakes';
import { TaxonomyService } from './taxonomy';

export interface Services {
  taxonomy: TaxonomyService;
  assets: AssetService;
  stocktakes: StocktakeService;
  accounts: SharedAccountService;
  reviews: ReviewService;
}

const cache = new WeakMap<ModuleContext, Services>();

/** One set of services per module context (routes, tools, resolvers, events, jobs and the seed share them). */
export function services(ctx: ModuleContext): Services {
  let s = cache.get(ctx);
  if (!s) {
    const assets = new AssetService(ctx);
    s = {
      taxonomy: new TaxonomyService(ctx),
      assets,
      stocktakes: new StocktakeService(ctx, assets),
      accounts: new SharedAccountService(ctx),
      reviews: new ReviewService(ctx),
    };
    cache.set(ctx, s);
  }
  return s;
}
