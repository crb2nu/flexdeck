import { healthStore } from './health';
import {
  flexinferCacheError,
  flexinferCacheLoading,
  flexinferCaches,
  flexinferCatalogError,
  flexinferCatalogLoading,
  flexinferCatalogs,
  flexinferProxyError,
  flexinferProxyLoading,
  flexinferProxyMetrics,
  flexinferRegistryError,
  flexinferRegistryLoading,
  flexinferRegistryModels,
} from './flexinferOperational';
import {
  buildFlexInferInferenceHealthState,
  buildFlexInferModelCountState,
  buildFlexInferSupplyChainSummary,
} from '../lib/flexinferSummary';

export const flexinferModelCount = () =>
  buildFlexInferModelCountState(
    flexinferRegistryModels(),
    flexinferRegistryLoading(),
    flexinferRegistryError() || '',
  );

export const flexinferInferenceFeatureEnabled = () =>
  healthStore.features.flexinfer_proxy?.enabled ?? false;

export const flexinferInferenceHealth = () =>
  buildFlexInferInferenceHealthState(
    flexinferInferenceFeatureEnabled(),
    flexinferProxyMetrics(),
    flexinferProxyLoading(),
    flexinferProxyError() || '',
  );

export const flexinferProxyTotals = () => flexinferProxyMetrics()?.totals ?? null;

export const flexinferSupplyChainSummary = () =>
  buildFlexInferSupplyChainSummary(flexinferCatalogs(), flexinferCaches());

export const flexinferSupplyChainLoading = () =>
  flexinferCatalogLoading() || flexinferCacheLoading();

export const flexinferSupplyChainError = () =>
  flexinferCatalogError() || flexinferCacheError() || '';
