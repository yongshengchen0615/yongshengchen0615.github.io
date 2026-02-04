export const state = {
  _eventsBound: false,

  // 簡易快取：避免篩選（狀態/搜尋/備註）時重打 API
  cache: {
    rows: [],
    nowMs: 0,
    fetchedAtMs: 0,
  },

  _refreshSeq: 0,
  _refreshing: false,

  selectedSerials: new Set(),
  _visibleSelectableSerials: [],
  _visibleActiveSerials: [],

  _lastRows: [],

  me: {
    userId: "",
    displayName: "",
    audit: "",
  },
};
