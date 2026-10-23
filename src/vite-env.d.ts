/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MCD_MCP_URL?: string;
  readonly VITE_MCD_COIN_SKU_ID?: string;
  readonly VITE_MCD_COUPON_SKU_ID?: string;
  readonly VITE_MCD_COIN_ORDER_ARGS?: string;
  readonly VITE_MCD_COUPON_ORDER_ARGS?: string;
  readonly VITE_MCD_COIN_COUNT?: string;
  readonly VITE_MCD_COUPON_COUNT?: string;
  readonly VITE_MCD_MOCK?: string;
  readonly VITE_MCD_MOCK_POINTS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
