export const state = {
  _eventsBound: false,

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
