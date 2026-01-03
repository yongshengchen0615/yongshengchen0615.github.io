/* ================================
 * 00_state.js
 * Global state (no DOM work)
 * ================================ */

// Config (loaded from config.json)
let API_BASE_URL = "";
let ADMIN_API_URL = "";
let LIFF_ID = "";

// Users data
let allUsers = [];
let filteredUsers = [];

// Sorting
let sortKey = "createdAt";
let sortDir = "desc";

// Selection & dirty tracking
const selectedIds = new Set();
const originalMap = new Map();
const dirtyMap = new Map();

// UI state
let toastTimer = null;
let savingAll = false;

// Admin auth / permissions
let adminPerms = null; // { pushFeatureEnabled, techAudit, ... }
let adminProfile = null; // { userId, displayName }

// View tabs
const VIEW_ENUM = ["all", "usage", "master", "features"];
let currentView = localStorage.getItem("users_view") || "usage";

// Push panel
let pushingNow = false;

