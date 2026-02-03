const CONFIG_JSON_URL = "./config.json";

export const config = {
  TOPUP_API_URL: "",

  USE_LIFF: true,
  LIFF_ID: "",

  DEBUG_USER_ID: "dev_user",
  DEBUG_DISPLAY_NAME: "測試使用者",

  PAGE_TITLE: "儲值序號後台",
  PAGE_SUBTITLE: "序號管理 / 匯入 / 作廢",

  LIST_LIMIT: 300,
};

export async function loadConfigJson() {
  const resp = await fetch(CONFIG_JSON_URL, { method: "GET", cache: "no-store" });
  if (!resp.ok) throw new Error("CONFIG_HTTP_" + resp.status);
  const cfg = await resp.json();

  config.TOPUP_API_URL = String(cfg.TOPUP_API_URL || "").trim();
  config.USE_LIFF = cfg.USE_LIFF === false ? false : true;
  config.LIFF_ID = String(cfg.LIFF_ID || "").trim();

  config.DEBUG_USER_ID = String(cfg.DEBUG_USER_ID || config.DEBUG_USER_ID).trim();
  config.DEBUG_DISPLAY_NAME = String(cfg.DEBUG_DISPLAY_NAME || config.DEBUG_DISPLAY_NAME).trim();

  config.PAGE_TITLE = String(cfg.PAGE_TITLE || config.PAGE_TITLE).trim();
  config.PAGE_SUBTITLE = String(cfg.PAGE_SUBTITLE || config.PAGE_SUBTITLE).trim();

  const limit = Number(cfg.LIST_LIMIT);
  if (Number.isFinite(limit) && limit > 0 && limit <= 1000) config.LIST_LIMIT = limit;

  if (!config.TOPUP_API_URL) throw new Error("config.json missing TOPUP_API_URL");
  if (config.USE_LIFF && !config.LIFF_ID) throw new Error("config.json missing LIFF_ID (USE_LIFF=true)");
}
