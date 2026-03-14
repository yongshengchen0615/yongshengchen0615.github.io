const SHEETS = {
  config: 'Config',
  adminUsers: 'AdminUsers',
  superAdmins: 'SuperAdmins',
  services: 'Services',
  technicians: 'Technicians',
  schedules: 'Schedules',
  users: 'Users',
  reservations: 'Reservations',
};

/* ---------- Status Constants ---------- */
const STATUS_APPROVED = '已通過';
const STATUS_PENDING = '待審核';
const STATUS_REJECTED = '已拒絕';
const STATUS_DISABLED = '已停用';
const STATUS_DRAFT = '未送審核';
const STATUS_UNLINKED = '未綁定';

const RESERVATION_STATUS_BOOKED = '已預約';
const RESERVATION_STATUS_COMPLETED = '已完成';
const RESERVATION_STATUS_CANCELLED = '已取消';

const ASSIGNMENT_TYPE_ON_SITE = '現場安排';
const ASSIGNMENT_TYPE_DESIGNATED = '指定技師';

const DEFAULT_DISPLAY_NAME_USER = 'LINE 使用者';
const DEFAULT_DISPLAY_NAME_ADMIN = 'LINE 管理員';
const DEFAULT_DISPLAY_NAME_TECHNICIAN = 'LINE 技師';
const DEFAULT_DISPLAY_NAME_SUPER_ADMIN = 'LINE 最高管理員';

const MINUTES_PER_DAY = 24 * 60;
const SERVICE_NAME_SEPARATOR = '、';

const ADMIN_PAGE_KEYS = ['service', 'technician', 'schedule', 'reservation', 'user'];
const ADMIN_PAGE_PERMISSION_NONE = '__NONE__';
const ADMIN_ACTION_PAGE_MAP = {
  saveService: 'service',
  deleteService: 'service',
  saveTechnician: 'technician',
  saveTechnicianServices: 'technician',
  deleteTechnician: 'technician',
  batchSaveTechnicians: 'technician',
  batchDeleteTechnicians: 'technician',
  reviewTechnician: 'technician',
  saveSchedule: 'schedule',
  deleteSchedule: 'schedule',
  batchSaveSchedules: 'schedule',
  saveReservation: 'reservation',
  deleteReservation: 'reservation',
  reviewUser: 'user',
  deleteUser: 'user',
};

const TEXT_COLUMNS_BY_SHEET = {
  Users: ['phone'],
  Reservations: ['phone'],
};

const DATA_CACHE_TTL_SECONDS = {
  publicData: 20,
  adminData: 12,
  superAdminData: 12,
};

const DATA_VERSION_PROPERTY = 'DATA_CACHE_VERSION';

var REQUEST_CONTEXT_ = null;

function doGet(e) {
  beginRequestContext_();
  try {
    initializeSheets_();
    var action = getRequestValue_(e, 'action');

    if (action === 'publicData') {
      return jsonResponse_({ ok: true, data: getPublicData_() });
    }

    if (action === 'technicianData') {
      var technicianUser = verifyTechnicianAccess_(getRequestValue_(e, 'technicianUserId'));
      return jsonResponse_({ ok: true, data: getTechnicianData_(technicianUser) });
    }

    if (action === 'adminData') {
      var adminUser = verifyAdminAccess_(getRequestValue_(e, 'adminUserId'));
      return jsonResponse_({ ok: true, data: getAdminData_(adminUser) });
    }

    if (action === 'superAdminData') {
      verifySuperAdminAccess_(getRequestValue_(e, 'adminUserId'));
      return jsonResponse_({ ok: true, data: getSuperAdminData_() });
    }

    return jsonResponse_({ ok: true, message: 'Beauty reservation GAS API is running.' });
  } catch (error) {
    return jsonResponse_({ ok: false, message: error.message });
  } finally {
    endRequestContext_();
  }
}

function doPost(e) {
  beginRequestContext_();
  try {
    initializeSheets_();
    var body = parseRequestBody_(e);
    var action = body.action;
    var payload = body.payload || {};

    /* --- Public actions (no admin required) --- */
    var publicActions = {
      syncLineUser:         function() { return syncLineUser_(payload); },
      syncAdminUser:        function() { return syncAdminUser_(payload); },
      syncTechnicianUser:   function() { return syncTechnicianUser_(payload); },
      syncSuperAdminUser:   function() { return syncSuperAdminUser_(payload); },
      submitUserApplication:function() { return submitUserApplication_(payload); },
      createReservation:    function() { return createReservation_(payload); },
    };

    if (publicActions[action]) {
      return jsonResponse_({ ok: true, data: publicActions[action]() });
    }

    /* --- Super-admin actions --- */
    var superAdminActions = {
      updateAdminPermission:   function() { return updateAdminPermission_(payload, body.adminUserId); },
      reviewAdminUser:         function() { return reviewAdminUser_(payload, body.adminUserId, true); },
      updateAdminReviewStatus: function() { return reviewAdminUser_(payload, body.adminUserId, true); },
      deleteAdminUser:         function() { return deleteAdminUser_(payload, body.adminUserId); },
    };

    if (superAdminActions[action]) {
      verifySuperAdminAccess_(body.adminUserId);
      return jsonResponse_({ ok: true, data: superAdminActions[action]() });
    }

    /* --- Admin permission manager actions (canManageAdmins) --- */
    var adminPermActions = {
      adminReviewAdmin:            function() { return reviewAdminUser_(payload, body.adminUserId, true); },
      adminUpdateAdminPermission:  function() { return updateAdminPermission_(payload, body.adminUserId); },
      adminDeleteAdmin:            function() { return deleteAdminUserByPermManager_(payload, body.adminUserId); },
    };

    if (adminPermActions[action]) {
      ensureAdminPermissionManager_(body.adminUserId);
      return jsonResponse_({ ok: true, data: adminPermActions[action]() });
    }

    /* --- Admin actions (with page permission) --- */
    var adminActor = verifyAdminAccess_(body.adminUserId);
    var adminActions = {
      reviewUser:            function() { return reviewUser_(payload); },
      reviewTechnician:      function() { return reviewTechnician_(payload); },
      deleteUser:            function() { return deleteUser_(payload); },
      saveService:           function() { return saveService_(payload); },
      saveTechnician:        function() { return saveTechnician_(payload); },
      saveTechnicianServices:function() { return saveTechnicianServices_(payload); },
      saveSchedule:          function() { return saveSchedule_(payload); },
      saveReservation:       function() { return saveReservation_(payload); },
      deleteService:         function() { return deleteService_(payload); },
      deleteTechnician:      function() { return deleteTechnician_(payload); },
      deleteSchedule:        function() { return deleteSchedule_(payload); },
      deleteReservation:     function() { return deleteReservation_(payload); },
      batchSaveSchedules:    function() { return batchSaveSchedules_(payload); },
      batchSaveTechnicians:  function() { return batchSaveTechnicians_(payload); },
      batchDeleteTechnicians:function() { return batchDeleteTechnicians_(payload); },
    };

    if (adminActions[action]) {
      ensureAdminActionAccess_(adminActor, action);
      return jsonResponse_({ ok: true, data: adminActions[action]() });
    }

    throw new Error('不支援的操作類型');
  } catch (error) {
    return jsonResponse_({ ok: false, message: error.message });
  } finally {
    endRequestContext_();
  }
}

function getPublicData_() {
  return getCachedDataset_('publicData', function() {
    var services = getTableRecords_(SHEETS.services).filter(function(item) {
      return toBoolean_(item.active);
    });
    var technicians = getTableRecords_(SHEETS.technicians)
      .map(normalizeTechnician_)
      .filter(function(item) {
        return toBoolean_(item.active);
      });
    var schedules = getTableRecords_(SHEETS.schedules)
      .map(normalizeSchedule_)
      .filter(function(item) {
        return toBoolean_(item.isWorking);
      });
    var reservations = getTableRecords_(SHEETS.reservations).map(normalizeReservation_);

    return {
      services: services.map(normalizeService_),
      technicians: technicians,
      schedules: schedules,
      reservations: reservations,
    };
  }, DATA_CACHE_TTL_SECONDS.publicData);
}

function getAdminData_(adminUser) {
  var permissionsKey = (adminUser && adminUser.pagePermissions || []).join('|') || ADMIN_PAGE_PERMISSION_NONE;
  var manageAdminsKey = adminUser && adminUser.canManageAdmins ? 'manage' : 'basic';
  return getCachedDataset_('adminData:' + String(adminUser && adminUser.userId || '') + ':' + permissionsKey + ':' + manageAdminsKey, function() {
    var adminUsers = getTableRecords_(SHEETS.adminUsers).map(normalizeAdminUser_);
    var services = getTableRecords_(SHEETS.services).map(normalizeService_);
    var technicians = getTableRecords_(SHEETS.technicians).map(normalizeTechnician_);
    var schedules = getTableRecords_(SHEETS.schedules).map(normalizeSchedule_);
    var users = getTableRecords_(SHEETS.users).map(normalizeUser_);
    var reservations = getTableRecords_(SHEETS.reservations).map(normalizeReservation_);
    var serviceMap = indexBy_(services, 'serviceId');
    var technicianMap = indexBy_(technicians, 'technicianId');
    var userMap = indexBy_(users, 'userId');

    reservations = reservations.map(function(item) {
      return enrichReservation_(item, serviceMap, technicianMap, userMap);
    });

    var currentAdminUser = adminUsers.find(function(item) {
      return item.userId === String(adminUser && adminUser.userId || '').trim();
    }) || adminUser;
    var canViewServices = hasAdminPagePermission_(currentAdminUser, 'service') || hasAdminPagePermission_(currentAdminUser, 'technician') || hasAdminPagePermission_(currentAdminUser, 'reservation');
    var canViewTechnicians = hasAdminPagePermission_(currentAdminUser, 'technician') || hasAdminPagePermission_(currentAdminUser, 'schedule') || hasAdminPagePermission_(currentAdminUser, 'reservation');
    var visibleAdminUsers = currentAdminUser && currentAdminUser.canManageAdmins ? adminUsers : (currentAdminUser ? [currentAdminUser] : []);

    return {
      adminUsers: visibleAdminUsers,
      currentAdminUser: currentAdminUser,
      services: canViewServices ? services : [],
      technicians: canViewTechnicians ? technicians : [],
      schedules: hasAdminPagePermission_(currentAdminUser, 'schedule') ? schedules : [],
      users: hasAdminPagePermission_(currentAdminUser, 'user') ? users : [],
      reservations: hasAdminPagePermission_(currentAdminUser, 'reservation') ? reservations : [],
    };
  }, DATA_CACHE_TTL_SECONDS.adminData);
}

function getTechnicianData_(technicianUser) {
  return getCachedDataset_('technicianData:' + String(technicianUser.technicianId || ''), function() {
    var services = getTableRecords_(SHEETS.services).map(normalizeService_);
    var schedules = getTableRecords_(SHEETS.schedules).map(normalizeSchedule_);
    var reservations = getTableRecords_(SHEETS.reservations).map(normalizeReservation_);
    var users = getTableRecords_(SHEETS.users).map(normalizeUser_);
    var serviceMap = indexBy_(services, 'serviceId');
    var userMap = indexBy_(users, 'userId');
    var technicianId = String(technicianUser.technicianId || '').trim();

    return {
      technician: technicianUser,
      services: services.filter(function(service) {
        return technicianUser.serviceIds.indexOf(service.serviceId) !== -1;
      }),
      schedules: schedules
        .filter(function(schedule) {
          return schedule.technicianId === technicianId;
        })
        .sort(function(left, right) {
          return (String(left.date) + ' ' + String(left.startTime)).localeCompare(String(right.date) + ' ' + String(right.startTime));
        }),
      reservations: reservations
        .filter(function(reservation) {
          return reservation.technicianId === technicianId;
        })
        .map(function(item) {
          return enrichReservation_(item, serviceMap, null, userMap);
        })
        .sort(function(left, right) {
          return (String(right.date) + ' ' + String(right.startTime)).localeCompare(String(left.date) + ' ' + String(left.startTime));
        }),
    };
  }, DATA_CACHE_TTL_SECONDS.adminData);
}

function getSuperAdminData_() {
  return getCachedDataset_('superAdminData', function() {
    return {
      adminUsers: getTableRecords_(SHEETS.adminUsers).map(normalizeAdminUser_),
      superAdmins: getResolvedSuperAdminUsers_(),
    };
  }, DATA_CACHE_TTL_SECONDS.superAdminData);
}

function syncLineUser_(payload) {
  validateRequired_(payload.userId, 'userId');

  var userId = String(payload.userId || '').trim();
  var users = getTableRecords_(SHEETS.users).map(normalizeUser_);
  var existing = users.find(function(item) {
    return item.userId === userId;
  });
  var nowText = toIsoString_(new Date());
  var status = existing ? existing.status : STATUS_DRAFT;

  var record = {
    userId: userId,
    displayName: String(payload.displayName || existing && existing.displayName || DEFAULT_DISPLAY_NAME_USER).trim() || DEFAULT_DISPLAY_NAME_USER,
    customerName: String(existing && existing.customerName || '').trim(),
    phone: String(existing && existing.phone || '').trim(),
    pictureUrl: String(payload.pictureUrl || existing && existing.pictureUrl || '').trim(),
    status: normalizeUserStatus_(status),
    note: existing ? existing.note : '',
    createdAt: existing ? existing.createdAt : nowText,
    updatedAt: nowText,
    lastLoginAt: nowText,
  };

  upsertRecord_(SHEETS.users, 'userId', record);
  return normalizeUser_(record);
}

function syncAdminUser_(payload) {
  validateRequired_(payload.userId, 'userId');

  var userId = String(payload.userId || '').trim();
  var nowText = toIsoString_(new Date());
  var approvedSuperAdmin = findApprovedSuperAdmin_(userId);
  var adminUsers = getTableRecords_(SHEETS.adminUsers).map(normalizeAdminUser_);
  var existing = adminUsers.find(function(item) {
    return item.userId === userId;
  });

  if (approvedSuperAdmin) {
    if (existing) {
      var mergedAdminRecord = {
        userId: existing.userId,
        displayName: String(payload.displayName || approvedSuperAdmin.displayName || existing.displayName || DEFAULT_DISPLAY_NAME_SUPER_ADMIN).trim() || DEFAULT_DISPLAY_NAME_SUPER_ADMIN,
        pictureUrl: String(payload.pictureUrl || approvedSuperAdmin.pictureUrl || existing.pictureUrl || '').trim(),
        status: STATUS_APPROVED,
        canManageAdmins: normalizeAdminPermissionValue_(existing.canManageAdmins, existing.status, existing.userId),
        pagePermissions: serializeAdminPagePermissions_(normalizeStoredAdminPagePermissions_(existing.pagePermissions, existing.userId), existing.userId),
        note: String(approvedSuperAdmin.note || existing.note || '').trim(),
        createdAt: existing.createdAt,
        updatedAt: nowText,
        lastLoginAt: nowText,
      };

      upsertRecord_(SHEETS.adminUsers, 'userId', mergedAdminRecord);
      return buildAdminIdentityFromSuperAdmin_(approvedSuperAdmin, normalizeAdminUser_(mergedAdminRecord));
    }

    return buildAdminIdentityFromSuperAdmin_(approvedSuperAdmin, {
      userId: userId,
      displayName: String(payload.displayName || approvedSuperAdmin.displayName || DEFAULT_DISPLAY_NAME_SUPER_ADMIN).trim() || DEFAULT_DISPLAY_NAME_SUPER_ADMIN,
      pictureUrl: String(payload.pictureUrl || approvedSuperAdmin.pictureUrl || '').trim(),
      status: STATUS_APPROVED,
      canManageAdmins: false,
      pagePermissions: ADMIN_PAGE_PERMISSION_NONE,
      note: String(approvedSuperAdmin.note || '').trim(),
      createdAt: String(approvedSuperAdmin.createdAt || ''),
      updatedAt: nowText,
      lastLoginAt: nowText,
    });
  }

  var nextStatus = existing && existing.status
    ? existing.status
    : STATUS_PENDING;
  var nextCanManageAdmins = existing && existing.canManageAdmins !== undefined
    ? normalizeAdminPermissionValue_(existing.canManageAdmins, existing.status, userId)
    : normalizeAdminPermissionValue_('', nextStatus, userId);

  var record = {
    userId: userId,
    displayName: String(payload.displayName || existing && existing.displayName || DEFAULT_DISPLAY_NAME_ADMIN).trim() || DEFAULT_DISPLAY_NAME_ADMIN,
    pictureUrl: String(payload.pictureUrl || existing && existing.pictureUrl || '').trim(),
    status: normalizeAdminStatus_(nextStatus),
    canManageAdmins: nextCanManageAdmins,
    pagePermissions: serializeAdminPagePermissions_(normalizeStoredAdminPagePermissions_(existing && existing.pagePermissions, userId), userId),
    note: existing ? existing.note : '',
    createdAt: existing ? existing.createdAt : nowText,
    updatedAt: nowText,
    lastLoginAt: nowText,
  };

  upsertRecord_(SHEETS.adminUsers, 'userId', record);
  return normalizeAdminUser_(record);
}

function syncTechnicianUser_(payload) {
  validateRequired_(payload.userId, 'userId');

  var userId = String(payload.userId || '').trim();
  var technicianId = String(payload.technicianId || '').trim();
  var technicians = getTableRecords_(SHEETS.technicians).map(normalizeTechnician_);
  var existing = technicians.find(function(item) {
    return item.lineUserId === userId;
  });

  if (!existing && technicianId) {
    existing = technicians.find(function(item) {
      return item.technicianId === technicianId && !String(item.lineUserId || '').trim();
    });
  }

  if (!existing) {
    var displayName = String(payload.displayName || '').trim();
    var matches = technicians.filter(function(item) {
      return !String(item.lineUserId || '').trim() && item.name === displayName;
    });
    if (matches.length === 1) {
      existing = matches[0];
    }
  }

  var nowText = toIsoString_(new Date());
  var record = {
    technicianId: existing && existing.technicianId ? existing.technicianId : createId_('TEC'),
    name: String(existing && existing.name || payload.displayName || '技師').trim() || '技師',
    serviceIds: existing ? existing.serviceIds.join(',') : '',
    startTime: existing ? existing.startTime : '09:00',
    endTime: existing ? existing.endTime : '18:00',
    active: existing ? existing.active : false,
    updatedAt: nowText,
    lineUserId: userId,
    profileDisplayName: String(payload.displayName || existing && existing.profileDisplayName || existing && existing.name || DEFAULT_DISPLAY_NAME_TECHNICIAN).trim() || DEFAULT_DISPLAY_NAME_TECHNICIAN,
    pictureUrl: String(payload.pictureUrl || existing && existing.pictureUrl || '').trim(),
    reviewStatus: existing && existing.lineUserId ? normalizeTechnicianStatus_(existing.status, userId) : STATUS_PENDING,
    reviewNote: existing ? existing.note : '',
    lastLoginAt: nowText,
  };

  upsertRecord_(SHEETS.technicians, 'technicianId', record);
  return normalizeTechnician_(record);
}

function syncSuperAdminUser_(payload) {
  validateRequired_(payload.userId, 'userId');

  var userId = String(payload.userId || '').trim();
  var superAdmins = getStoredSuperAdminUsers_();
  var existing = superAdmins.find(function(item) {
    return item.userId === userId;
  });
  var nowText = toIsoString_(new Date());

  var record = {
    userId: userId,
    displayName: String(payload.displayName || existing && existing.displayName || DEFAULT_DISPLAY_NAME_SUPER_ADMIN).trim() || DEFAULT_DISPLAY_NAME_SUPER_ADMIN,
    pictureUrl: String(payload.pictureUrl || existing && existing.pictureUrl || '').trim(),
    status: normalizeAdminStatus_(existing && existing.status ? existing.status : STATUS_PENDING),
    note: existing ? existing.note : '',
    createdAt: existing ? existing.createdAt : nowText,
    updatedAt: nowText,
    lastLoginAt: nowText,
  };

  upsertRecord_(SHEETS.superAdmins, 'userId', record);
  return normalizeSuperAdminUser_(record);
}

function submitUserApplication_(payload) {
  validateRequired_(payload.userId, 'userId');
  validateRequired_(payload.customerName, 'customerName');
  validateRequired_(payload.phone, 'phone');

  var userId = String(payload.userId || '').trim();
  var normalizedPhone = normalizePhone_(payload.phone, true);
  var users = getTableRecords_(SHEETS.users).map(normalizeUser_);
  var existing = users.find(function(item) {
    return item.userId === userId;
  });
  var nowText = toIsoString_(new Date());
  var nextStatus = STATUS_PENDING;

  if (existing && (existing.status === STATUS_APPROVED || existing.status === STATUS_DISABLED || existing.status === STATUS_REJECTED)) {
    nextStatus = existing.status;
  }

  var record = {
    userId: userId,
    displayName: String(payload.displayName || existing && existing.displayName || DEFAULT_DISPLAY_NAME_USER).trim() || DEFAULT_DISPLAY_NAME_USER,
    customerName: String(payload.customerName || existing && existing.customerName || '').trim(),
    phone: normalizedPhone,
    pictureUrl: String(payload.pictureUrl || existing && existing.pictureUrl || '').trim(),
    status: normalizeUserStatus_(nextStatus),
    note: existing ? existing.note : '',
    createdAt: existing ? existing.createdAt : nowText,
    updatedAt: nowText,
    lastLoginAt: existing ? existing.lastLoginAt : nowText,
  };

  upsertRecord_(SHEETS.users, 'userId', record);
  return normalizeUser_(record);
}

function reviewUser_(payload) {
  validateRequired_(payload.userId, 'userId');
  validateRequired_(payload.status, 'status');

  var users = getTableRecords_(SHEETS.users).map(normalizeUser_);
  var existing = users.find(function(item) {
    return item.userId === String(payload.userId || '').trim();
  });

  if (!existing) {
    throw new Error('找不到用戶');
  }

  var record = {
    userId: existing.userId,
    displayName: existing.displayName,
    customerName: existing.customerName,
    phone: existing.phone,
    pictureUrl: existing.pictureUrl,
    status: normalizeUserStatus_(payload.status),
    note: String(payload.note || existing.note || '').trim(),
    createdAt: existing.createdAt,
    updatedAt: toIsoString_(new Date()),
    lastLoginAt: existing.lastLoginAt,
  };

  upsertRecord_(SHEETS.users, 'userId', record);
  return normalizeUser_(record);
}

function reviewTechnician_(payload) {
  validateRequired_(payload.technicianId, 'technicianId');
  validateRequired_(payload.status, 'status');

  var technicians = getTableRecords_(SHEETS.technicians).map(normalizeTechnician_);
  var existing = technicians.find(function(item) {
    return item.technicianId === String(payload.technicianId || '').trim();
  });

  if (!existing) {
    throw new Error('找不到技師');
  }

  if (!String(existing.lineUserId || '').trim()) {
    throw new Error('此技師尚未完成 LINE 登入，無法審核');
  }

  var record = {
    technicianId: existing.technicianId,
    name: existing.name,
    serviceIds: existing.serviceIds.join(','),
    startTime: existing.startTime,
    endTime: existing.endTime,
    active: existing.active,
    updatedAt: toIsoString_(new Date()),
    lineUserId: existing.lineUserId,
    profileDisplayName: existing.profileDisplayName,
    pictureUrl: existing.pictureUrl,
    reviewStatus: normalizeTechnicianStatus_(payload.status, existing.lineUserId),
    reviewNote: String(payload.note || existing.note || '').trim(),
    lastLoginAt: existing.lastLoginAt,
  };

  upsertRecord_(SHEETS.technicians, 'technicianId', record);
  return normalizeTechnician_(record);
}

function reviewAdminUser_(payload, actorUserId, skipPermissionCheck) {
  validateRequired_(payload.userId, 'userId');
  validateRequired_(payload.status, 'status');

  var actorIsApprovedSuperAdmin = Boolean(findApprovedSuperAdmin_(actorUserId));

  if (!skipPermissionCheck) {
    ensureAdminPermissionManager_(actorUserId);
  }

  var adminUsers = getTableRecords_(SHEETS.adminUsers).map(normalizeAdminUser_);
  var existing = adminUsers.find(function(item) {
    return item.userId === String(payload.userId || '').trim();
  });

  if (!existing) {
    throw new Error('找不到管理員');
  }

  var nextStatus = normalizeAdminStatus_(payload.status);
  if (!actorIsApprovedSuperAdmin && String(actorUserId || '').trim() === existing.userId && nextStatus !== STATUS_APPROVED) {
    throw new Error('不能將自己改成不可使用的管理員狀態');
  }

  if (existing.status === STATUS_APPROVED && nextStatus !== STATUS_APPROVED) {
    ensureApprovedAdminRemains_(existing.userId);
  }

  var record = {
    userId: existing.userId,
    displayName: existing.displayName,
    pictureUrl: existing.pictureUrl,
    status: nextStatus,
    canManageAdmins: normalizeAdminPermissionValue_(existing.canManageAdmins, nextStatus, existing.userId),
    pagePermissions: serializeAdminPagePermissions_(normalizeStoredAdminPagePermissions_(existing.pagePermissions, existing.userId), existing.userId),
    note: String(payload.note || existing.note || '').trim(),
    createdAt: existing.createdAt,
    updatedAt: toIsoString_(new Date()),
    lastLoginAt: existing.lastLoginAt,
  };

  upsertRecord_(SHEETS.adminUsers, 'userId', record);
  return normalizeAdminUser_(record);
}

function updateAdminPermission_(payload, actorUserId) {
  validateRequired_(payload.userId, 'userId');

  var adminUsers = getTableRecords_(SHEETS.adminUsers).map(normalizeAdminUser_);
  var existing = adminUsers.find(function(item) {
    return item.userId === String(payload.userId || '').trim();
  });

  if (!existing) {
    throw new Error('找不到管理員');
  }

  var hasCanManageAdmins = Object.prototype.hasOwnProperty.call(payload, 'canManageAdmins');
  var hasPagePermissions = Object.prototype.hasOwnProperty.call(payload, 'pagePermissions');
  var hasNote = Object.prototype.hasOwnProperty.call(payload, 'note');
  var canManageAdmins = hasCanManageAdmins
    ? toBoolean_(payload.canManageAdmins)
    : normalizeAdminPermissionValue_(existing.canManageAdmins, existing.status, existing.userId);
  var nextPagePermissions = hasPagePermissions
    ? normalizeAdminPagePermissionList_(payload.pagePermissions)
    : normalizeStoredAdminPagePermissions_(existing.pagePermissions, existing.userId);

  var record = {
    userId: existing.userId,
    displayName: existing.displayName,
    pictureUrl: existing.pictureUrl,
    status: existing.status,
    canManageAdmins: canManageAdmins,
    pagePermissions: serializeAdminPagePermissions_(nextPagePermissions, existing.userId),
    note: hasNote ? sanitizeTextInput_(payload.note || '') : String(existing.note || '').trim(),
    createdAt: existing.createdAt,
    updatedAt: toIsoString_(new Date()),
    lastLoginAt: existing.lastLoginAt,
  };

  upsertRecord_(SHEETS.adminUsers, 'userId', record);
  return normalizeAdminUser_(record);
}

function createReservation_(payload) {
  validateRequired_(payload.customerName, 'customerName');
  validateRequired_(payload.phone, 'phone');
  validateRequired_(payload.date, 'date');
  validateRequired_(payload.startTime, 'startTime');
  validateRequired_(payload.userId, 'userId');

  var normalizedPhone = normalizePhone_(payload.phone, true);
  var customerName = sanitizeTextInput_(payload.customerName);
  var note = sanitizeTextInput_(payload.note || '');

  var services = getTableRecords_(SHEETS.services).map(normalizeService_);
  var technicians = getTableRecords_(SHEETS.technicians).map(normalizeTechnician_);
  var schedules = getTableRecords_(SHEETS.schedules).map(normalizeSchedule_);
  var users = getTableRecords_(SHEETS.users).map(normalizeUser_);
  var reservations = getTableRecords_(SHEETS.reservations).map(normalizeReservation_);

  var serviceMap = indexBy_(services, 'serviceId');
  var technicianMap = indexBy_(technicians, 'technicianId');
  var userMap = indexBy_(users, 'userId');
  var serviceIds = normalizeServiceIds_(payload.serviceIds || payload.serviceId);
  var selectedServices = getServicesByIds_(serviceIds, serviceMap);
  var requestedTechnicianId = String(payload.technicianId || '').trim();
  var user = userMap[String(payload.userId || '').trim()];
  var reservationDate = normalizeDateString_(payload.date);
  var reservationStartTime = normalizeTimeString_(payload.startTime);

  if (!serviceIds.length) {
    throw new Error('請至少選擇一個服務項目');
  }

  if (!user) {
    throw new Error('找不到用戶資料，請重新登入 LINE');
  }

  if (!String(user.customerName || '').trim() || !String(user.phone || '').trim()) {
    throw new Error('請先完成稱呼與電話送審資料');
  }

  if (!isUserApproved_(user.status)) {
    throw new Error('此 LINE 帳號尚未通過審核，暫時無法預約');
  }

  serviceIds.forEach(function(serviceId) {
    var service = serviceMap[serviceId];
    if (!service || !toBoolean_(service.active)) {
      throw new Error('服務項目不存在或未啟用');
    }
  });

  var serviceDuration = selectedServices.reduce(function(sum, service) {
    return sum + Number(service.durationMinutes || 0);
  }, 0);
  var reservationStart = timeToMinutes_(reservationStartTime);
  var reservationEnd = reservationStart + serviceDuration;

  var candidateTechnicians = technicians
    .filter(function(item) {
      if (!toBoolean_(item.active)) {
        return false;
      }

      if (requestedTechnicianId && item.technicianId !== requestedTechnicianId) {
        return false;
      }

      return serviceIds.every(function(serviceId) {
        return item.serviceIds.indexOf(serviceId) !== -1;
      });
    })
    .sort(function(left, right) {
      return left.name.localeCompare(right.name, 'zh-Hant') || left.technicianId.localeCompare(right.technicianId);
    });

  if (requestedTechnicianId && !candidateTechnicians.length) {
    if (!technicianMap[requestedTechnicianId] || !toBoolean_(technicianMap[requestedTechnicianId].active)) {
      throw new Error('技師不存在或未啟用');
    }

    throw new Error('此技師不可服務所選的其中一個項目');
  }

  if (!candidateTechnicians.length) {
    throw new Error('目前沒有技師可提供所選服務');
  }

  var matchedTechnician = null;
  var matchedSchedule = null;

  candidateTechnicians.some(function(technician) {
    var evaluation = evaluateReservationForTechnician_({
      technicianId: technician.technicianId,
      reservationDate: reservationDate,
      reservationStart: reservationStart,
      reservationEnd: reservationEnd,
      schedules: schedules,
      reservations: reservations,
      serviceMap: serviceMap,
    });

    if (!evaluation.ok) {
      return false;
    }

    matchedTechnician = technician;
    matchedSchedule = evaluation.schedule;
    return true;
  });

  if (!matchedTechnician || !matchedSchedule) {
    if (requestedTechnicianId) {
      var requestedEvaluation = evaluateReservationForTechnician_({
        technicianId: requestedTechnicianId,
        reservationDate: reservationDate,
        reservationStart: reservationStart,
        reservationEnd: reservationEnd,
        schedules: schedules,
        reservations: reservations,
        serviceMap: serviceMap,
      });

      if (requestedEvaluation.reason === 'no-schedule') {
        throw new Error('該日期沒有可預約班表');
      }

      if (requestedEvaluation.reason === 'out-of-range') {
        throw new Error('預約時段不在班表範圍內');
      }

      throw new Error('此時段已被預約，請重新選擇');
    }

    throw new Error('目前沒有符合條件的技師可安排此時段');
  }

  var assignmentType = requestedTechnicianId ? '' : ASSIGNMENT_TYPE_ON_SITE;

  var record = {
    reservationId: createId_('RES'),
    userId: user.userId,
    userDisplayName: user.displayName,
    customerName: customerName || String(user.customerName).trim(),
    phone: normalizedPhone,
    technicianId: matchedTechnician.technicianId,
    assignmentType: assignmentType,
    serviceId: serviceIds.join(','),
    date: reservationDate,
    startTime: reservationStartTime,
    endTime: minutesToTime_(reservationEnd),
    status: RESERVATION_STATUS_BOOKED,
    note: note,
    createdAt: toIsoString_(new Date()),
  };

  appendRecord_(SHEETS.reservations, record);
  record.technicianName = assignmentType || matchedTechnician.name;
  return record;
}

function batchSaveSchedules_(payload) {
  var items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) {
    throw new Error('沒有可儲存的班表資料');
  }

  return items.map(function(item) {
    return saveSchedule_(item || {});
  });
}

function batchSaveTechnicians_(payload) {
  var items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) {
    throw new Error('沒有可儲存的技師資料');
  }

  return items.map(function(item) {
    var normalizedItem = item || {};
    var technician = saveTechnician_({
      technicianId: normalizedItem.technicianId,
      name: normalizedItem.name,
      startTime: normalizedItem.startTime,
      endTime: normalizedItem.endTime,
      active: normalizedItem.active,
    });

    return saveTechnicianServices_({
      technicianId: technician.technicianId,
      serviceIds: normalizedItem.serviceIds || [],
    });
  });
}

function batchDeleteTechnicians_(payload) {
  var technicianIds = Array.isArray(payload.technicianIds) ? payload.technicianIds : [];
  if (!technicianIds.length) {
    throw new Error('沒有可刪除的技師資料');
  }

  return technicianIds.map(function(technicianId) {
    deleteTechnician_({ technicianId: technicianId });
    return String(technicianId || '').trim();
  });
}

function saveService_(payload) {
  validateRequired_(payload.name, 'name');
  validateRequired_(payload.durationMinutes, 'durationMinutes');

  var record = {
    serviceId: payload.serviceId || createId_('SRV'),
    name: String(payload.name).trim(),
    durationMinutes: Number(payload.durationMinutes),
    price: Number(payload.price || 0),
    active: toBoolean_(payload.active),
    updatedAt: toIsoString_(new Date()),
    category: normalizeCategoryValue_(payload.category),
  };

  upsertRecord_(SHEETS.services, 'serviceId', record);
  return normalizeService_(record);
}

function saveTechnician_(payload) {
  validateRequired_(payload.name, 'name');
  validateRequired_(payload.startTime, 'startTime');
  validateRequired_(payload.endTime, 'endTime');

  var technicianStartTime = normalizeTimeString_(payload.startTime);
  var technicianEndTime = normalizeTimeString_(payload.endTime);

  var technicianId = String(payload.technicianId || '');
  var technicianName = String(payload.name).trim();
  var technicians = getTableRecords_(SHEETS.technicians).map(normalizeTechnician_);
  var existing = technicians.find(function(item) {
    return item.technicianId === technicianId;
  });
  var duplicate = technicians.find(function(item) {
    return item.name === technicianName && item.technicianId !== technicianId;
  });

  if (duplicate) {
    throw new Error('技師名稱已存在，請直接編輯原有技師');
  }

  var record = {
    technicianId: technicianId || createId_('TEC'),
    name: technicianName,
    serviceIds: existing ? existing.serviceIds.join(',') : '',
    startTime: technicianStartTime,
    endTime: technicianEndTime,
    active: toBoolean_(payload.active),
    updatedAt: toIsoString_(new Date()),
    lineUserId: existing ? existing.lineUserId : '',
    profileDisplayName: existing ? existing.profileDisplayName : '',
    pictureUrl: existing ? existing.pictureUrl : '',
    reviewStatus: existing ? existing.status : '',
    reviewNote: existing ? existing.note : '',
    lastLoginAt: existing ? existing.lastLoginAt : '',
  };

  upsertRecord_(SHEETS.technicians, 'technicianId', record);
  return normalizeTechnician_(record);
}

function saveTechnicianServices_(payload) {
  validateRequired_(payload.technicianId, 'technicianId');

  var technicianId = String(payload.technicianId || '');
  var technicians = getTableRecords_(SHEETS.technicians).map(normalizeTechnician_);
  var technician = technicians.find(function(item) {
    return item.technicianId === technicianId;
  });

  if (!technician) {
    throw new Error('找不到技師');
  }

  var services = getTableRecords_(SHEETS.services).map(normalizeService_);
  var serviceMap = indexBy_(services, 'serviceId');
  var serviceIds = (payload.serviceIds || [])
    .map(function(serviceId) {
      return String(serviceId || '').trim();
    })
    .filter(function(serviceId, index, list) {
      return serviceId && list.indexOf(serviceId) === index;
    });

  serviceIds.forEach(function(serviceId) {
    if (!serviceMap[serviceId]) {
      throw new Error('包含不存在的服務項目');
    }
  });

  var record = {
    technicianId: technician.technicianId,
    name: technician.name,
    serviceIds: serviceIds.join(','),
    startTime: technician.startTime,
    endTime: technician.endTime,
    active: technician.active,
    updatedAt: toIsoString_(new Date()),
    lineUserId: technician.lineUserId,
    profileDisplayName: technician.profileDisplayName,
    pictureUrl: technician.pictureUrl,
    reviewStatus: technician.status,
    reviewNote: technician.note,
    lastLoginAt: technician.lastLoginAt,
  };

  upsertRecord_(SHEETS.technicians, 'technicianId', record);
  return normalizeTechnician_(record);
}

function saveSchedule_(payload) {
  validateRequired_(payload.technicianId, 'technicianId');
  validateRequired_(payload.date, 'date');
  validateRequired_(payload.startTime, 'startTime');
  validateRequired_(payload.endTime, 'endTime');

  var scheduleDate = normalizeDateString_(payload.date);
  var scheduleStartTime = normalizeTimeString_(payload.startTime);
  var scheduleEndTime = normalizeTimeString_(payload.endTime);

  var technicians = getTableRecords_(SHEETS.technicians).map(normalizeTechnician_);
  var exists = technicians.some(function(item) {
    return item.technicianId === payload.technicianId;
  });
  if (!exists) {
    throw new Error('找不到技師');
  }

  var existing = getTableRecords_(SHEETS.schedules).find(function(item) {
    return String(item.technicianId || '') === String(payload.technicianId || '')
      && normalizeDateString_(item.date) === scheduleDate;
  });

  var record = {
    scheduleId: existing && existing.scheduleId ? existing.scheduleId : createId_('SCH'),
    technicianId: payload.technicianId,
    date: scheduleDate,
    startTime: scheduleStartTime,
    endTime: scheduleEndTime,
    isWorking: toBoolean_(payload.isWorking),
    updatedAt: toIsoString_(new Date()),
  };

  upsertRecordByComposite_(SHEETS.schedules, ['technicianId', 'date'], record);
  return record;
}

function saveReservation_(payload) {
  validateRequired_(payload.customerName, 'customerName');
  validateRequired_(payload.phone, 'phone');
  validateRequired_(payload.technicianId, 'technicianId');
  validateRequired_(payload.date, 'date');
  validateRequired_(payload.startTime, 'startTime');

  var normalizedPhone = normalizePhone_(payload.phone, true);

  var services = getTableRecords_(SHEETS.services).map(normalizeService_);
  var technicians = getTableRecords_(SHEETS.technicians).map(normalizeTechnician_);
  var schedules = getTableRecords_(SHEETS.schedules).map(normalizeSchedule_);
  var reservations = getTableRecords_(SHEETS.reservations).map(normalizeReservation_);
  var serviceMap = indexBy_(services, 'serviceId');
  var technicianMap = indexBy_(technicians, 'technicianId');
  var serviceIds = normalizeServiceIds_(payload.serviceIds || payload.serviceId);
  var selectedServices = getServicesByIds_(serviceIds, serviceMap);
  var technician = technicianMap[payload.technicianId];
  var status = normalizeReservationStatus_(payload.status || RESERVATION_STATUS_BOOKED);
  var existing = reservations.find(function(item) {
    return item.reservationId === String(payload.reservationId || '');
  });

  if (!serviceIds.length) {
    throw new Error('請至少選擇一個服務項目');
  }
  if (!technician) {
    throw new Error('技師不存在');
  }

  serviceIds.forEach(function(serviceId) {
    if (!serviceMap[serviceId]) {
      throw new Error('服務項目不存在');
    }
    if (technician.serviceIds.indexOf(serviceId) === -1) {
      throw new Error('此技師不可服務所選的其中一個項目');
    }
  });

  var reservationStart = timeToMinutes_(payload.startTime);
  var reservationEnd = reservationStart + selectedServices.reduce(function(sum, service) {
    return sum + Number(service.durationMinutes || 0);
  }, 0);

  if (!isReservationCancelled_(status)) {
    serviceIds.forEach(function(serviceId) {
      if (!toBoolean_(serviceMap[serviceId].active)) {
        throw new Error('服務項目未啟用');
      }
    });
    if (!toBoolean_(technician.active)) {
      throw new Error('技師未啟用');
    }

    var evaluation = evaluateReservationForTechnician_({
      technicianId: payload.technicianId,
      reservationDate: normalizeDateString_(payload.date),
      reservationStart: reservationStart,
      reservationEnd: reservationEnd,
      schedules: schedules,
      reservations: reservations,
      serviceMap: serviceMap,
      ignoreReservationId: String(payload.reservationId || ''),
    });

    if (!evaluation.ok) {
      if (evaluation.reason === 'no-schedule') {
        throw new Error('該日期沒有可預約班表');
      }

      if (evaluation.reason === 'out-of-range') {
        throw new Error('預約時段不在班表範圍內');
      }

      throw new Error('此時段已被預約，請重新選擇');
    }
  }

  var record = {
    reservationId: existing && existing.reservationId ? existing.reservationId : createId_('RES'),
    userId: String(payload.userId || existing && existing.userId || '').trim(),
    userDisplayName: String(payload.userDisplayName || existing && existing.userDisplayName || '').trim(),
    customerName: sanitizeTextInput_(String(payload.customerName).trim()),
    phone: normalizedPhone,
    technicianId: payload.technicianId,
    assignmentType: String(payload.assignmentType || '').trim() || '',
    serviceId: serviceIds.join(','),
    date: normalizeDateString_(payload.date),
    startTime: normalizeTimeString_(payload.startTime),
    endTime: minutesToTime_(reservationEnd),
    status: status,
    note: sanitizeTextInput_(payload.note || ''),
    createdAt: existing && existing.createdAt ? existing.createdAt : toIsoString_(new Date()),
  };

  upsertRecord_(SHEETS.reservations, 'reservationId', record);
  return record;
}

function deleteService_(payload) {
  validateRequired_(payload.serviceId, 'serviceId');

  var serviceId = String(payload.serviceId);
  var services = getTableRecords_(SHEETS.services).map(normalizeService_);
  var technicians = getTableRecords_(SHEETS.technicians).map(normalizeTechnician_);
  var reservations = getTableRecords_(SHEETS.reservations).map(normalizeReservation_);

  var exists = services.some(function(item) {
    return item.serviceId === serviceId;
  });
  if (!exists) {
    throw new Error('找不到服務項目');
  }

  var linkedReservation = reservations.find(function(item) {
    return item.serviceIds.indexOf(serviceId) !== -1;
  });
  if (linkedReservation) {
    throw new Error('此服務已有歷史預約紀錄，不能直接刪除');
  }

  technicians
    .filter(function(item) {
      return item.serviceIds.indexOf(serviceId) !== -1;
    })
    .forEach(function(item) {
      var updatedRecord = {
        technicianId: item.technicianId,
        name: item.name,
        serviceIds: item.serviceIds.filter(function(id) {
          return id !== serviceId;
        }).join(','),
        startTime: item.startTime,
        endTime: item.endTime,
        active: item.active,
        updatedAt: toIsoString_(new Date()),
      };
      upsertRecord_(SHEETS.technicians, 'technicianId', updatedRecord);
    });

  deleteRecord_(SHEETS.services, 'serviceId', serviceId);
  return { serviceId: serviceId };
}

function deleteTechnician_(payload) {
  validateRequired_(payload.technicianId, 'technicianId');

  var technicianId = String(payload.technicianId);
  var technicians = getTableRecords_(SHEETS.technicians).map(normalizeTechnician_);
  var reservations = getTableRecords_(SHEETS.reservations).map(normalizeReservation_);

  var exists = technicians.some(function(item) {
    return item.technicianId === technicianId;
  });
  if (!exists) {
    throw new Error('找不到技師');
  }

  var linkedReservation = reservations.find(function(item) {
    return item.technicianId === technicianId;
  });
  if (linkedReservation) {
    throw new Error('此技師已有歷史預約紀錄，不能直接刪除');
  }

  deleteRecordsByPredicate_(SHEETS.schedules, function(item) {
    return String(item.technicianId) === technicianId;
  });

  deleteRecord_(SHEETS.technicians, 'technicianId', technicianId);
  return { technicianId: technicianId };
}

function deleteSchedule_(payload) {
  validateRequired_(payload.technicianId, 'technicianId');
  validateRequired_(payload.date, 'date');

  var technicianId = String(payload.technicianId || '').trim();
  var scheduleDate = normalizeDateString_(payload.date);
  var schedules = getTableRecords_(SHEETS.schedules).map(normalizeSchedule_);
  var reservations = getTableRecords_(SHEETS.reservations).map(normalizeReservation_);

  var exists = schedules.some(function(item) {
    return item.technicianId === technicianId && item.date === scheduleDate;
  });

  if (!exists) {
    throw new Error('找不到班表');
  }

  var schedule = schedules.find(function(item) {
    return item.technicianId === technicianId && item.date === scheduleDate;
  });

  var nextDate = isOvernightShift_(schedule.startTime, schedule.endTime)
    ? addDaysToDateString_(scheduleDate, 1)
    : '';

  var linkedReservation = reservations.find(function(item) {
    if (item.technicianId !== technicianId) return false;
    if (item.date === scheduleDate) return true;
    if (nextDate && item.date === nextDate) return true;
    return false;
  });

  if (linkedReservation) {
    throw new Error('此班表已有預約紀錄，不能直接刪除');
  }

  deleteRecordsByPredicate_(SHEETS.schedules, function(item) {
    return String(item.technicianId || '').trim() === technicianId
      && normalizeDateString_(item.date) === scheduleDate;
  });

  return {
    technicianId: technicianId,
    date: scheduleDate,
  };
}

function deleteReservation_(payload) {
  validateRequired_(payload.reservationId, 'reservationId');
  var reservationId = String(payload.reservationId);
  deleteRecord_(SHEETS.reservations, 'reservationId', reservationId);
  return { reservationId: reservationId };
}

function deleteUser_(payload) {
  validateRequired_(payload.userId, 'userId');

  var userId = String(payload.userId || '').trim();
  var users = getTableRecords_(SHEETS.users).map(normalizeUser_);
  var reservations = getTableRecords_(SHEETS.reservations).map(normalizeReservation_);

  var existing = users.find(function(item) {
    return item.userId === userId;
  });

  if (!existing) {
    throw new Error('找不到用戶');
  }

  var linkedReservation = reservations.find(function(item) {
    return String(item.userId || '') === userId;
  });

  if (linkedReservation) {
    throw new Error('此用戶已有歷史預約紀錄，不能直接刪除');
  }

  deleteRecord_(SHEETS.users, 'userId', userId);
  return { userId: userId };
}

function deleteAdminUser_(payload, actorUserId) {
  validateRequired_(payload.userId, 'userId');

  verifySuperAdminAccess_(actorUserId);

  var userId = String(payload.userId || '').trim();
  var adminUsers = getTableRecords_(SHEETS.adminUsers).map(normalizeAdminUser_);
  var existing = adminUsers.find(function(item) {
    return item.userId === userId;
  });

  if (!existing) {
    throw new Error('找不到管理員');
  }

  if (String(actorUserId || '').trim() === userId) {
    throw new Error('不能刪除自己的管理員帳號');
  }

  if (existing.status === STATUS_APPROVED) {
    ensureApprovedAdminRemains_(userId);
  }

  deleteRecord_(SHEETS.adminUsers, 'userId', userId);
  return { userId: userId };
}

function deleteAdminUserByPermManager_(payload, actorUserId) {
  validateRequired_(payload.userId, 'userId');

  var userId = String(payload.userId || '').trim();
  var adminUsers = getTableRecords_(SHEETS.adminUsers).map(normalizeAdminUser_);
  var existing = adminUsers.find(function(item) {
    return item.userId === userId;
  });

  if (!existing) {
    throw new Error('找不到管理員');
  }

  if (String(actorUserId || '').trim() === userId) {
    throw new Error('不能刪除自己的管理員帳號');
  }

  if (existing.status === STATUS_APPROVED) {
    ensureApprovedAdminRemains_(userId);
  }

  deleteRecord_(SHEETS.adminUsers, 'userId', userId);
  return { userId: userId };
}

function initializeSheets_() {
  ensureSheet_(SHEETS.config, ['key', 'value']);
  ensureSheet_(SHEETS.adminUsers, ['userId', 'displayName', 'pictureUrl', 'status', 'canManageAdmins', 'pagePermissions', 'note', 'createdAt', 'updatedAt', 'lastLoginAt']);
  ensureSheet_(SHEETS.superAdmins, ['userId', 'displayName', 'pictureUrl', 'status', 'note', 'createdAt', 'updatedAt', 'lastLoginAt']);
  ensureSheet_(SHEETS.services, ['serviceId', 'name', 'durationMinutes', 'price', 'active', 'updatedAt', 'category']);
  ensureSheet_(SHEETS.technicians, ['technicianId', 'name', 'serviceIds', 'startTime', 'endTime', 'active', 'updatedAt', 'lineUserId', 'profileDisplayName', 'pictureUrl', 'reviewStatus', 'reviewNote', 'lastLoginAt']);
  ensureSheet_(SHEETS.schedules, ['scheduleId', 'technicianId', 'date', 'startTime', 'endTime', 'isWorking', 'updatedAt']);
  ensureSheet_(SHEETS.users, ['userId', 'displayName', 'customerName', 'phone', 'pictureUrl', 'status', 'note', 'createdAt', 'updatedAt', 'lastLoginAt']);
  ensureSheet_(SHEETS.reservations, ['reservationId', 'userId', 'userDisplayName', 'customerName', 'phone', 'technicianId', 'assignmentType', 'serviceId', 'date', 'startTime', 'endTime', 'status', 'note', 'createdAt']);
  ensurePlainTextColumns_(SHEETS.users, ['phone']);
  ensurePlainTextColumns_(SHEETS.reservations, ['phone']);
  migrateLegacySuperAdmins_();
}

function ensureSheet_(sheetName, headers) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) {
    sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet(sheetName);
    markDataMutated_(true);
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    markDataMutated_(true);
  } else {
    var currentHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    var needsHeaderFix = headers.some(function(header, index) {
      return currentHeaders[index] !== header;
    });
    if (needsHeaderFix) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      markDataMutated_(true);
    }
  }
}

function ensurePlainTextColumns_(sheetName, columnNames) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet || sheet.getLastColumn() === 0) {
    return;
  }

  var headers = getSheetHeaders_(sheet);
  var rowCount = Math.max(sheet.getMaxRows() - 1, 1);

  columnNames.forEach(function(columnName) {
    var columnIndex = headers.indexOf(columnName);
    if (columnIndex === -1) {
      return;
    }

    sheet.getRange(2, columnIndex + 1, rowCount, 1).setNumberFormat('@');
  });
}

function getTableRecords_(sheetName) {
  return getTableSnapshot_(sheetName).records.slice();
}

function appendRecord_(sheetName, record) {
  var snapshot = getTableSnapshot_(sheetName);
  var sheet = snapshot.sheet;
  var headers = snapshot.headers;
  var row = buildSheetRow_(sheetName, headers, record);
  writeSheetRow_(sheetName, sheet, sheet.getLastRow() + 1, headers, row);
  snapshot.records.push(buildRecordFromRecord_(sheetName, headers, record));
  markDataMutated_(false);
}

function upsertRecord_(sheetName, primaryKey, record) {
  var snapshot = getTableSnapshot_(sheetName);
  var sheet = snapshot.sheet;
  var headers = snapshot.headers;
  var rowIndex = snapshot.records.findIndex(function(item) {
    return String(item[primaryKey]) === String(record[primaryKey]);
  });
  var row = buildSheetRow_(sheetName, headers, record);
  var nextRecord = buildRecordFromRecord_(sheetName, headers, record);

  if (rowIndex === -1) {
    writeSheetRow_(sheetName, sheet, sheet.getLastRow() + 1, headers, row);
    snapshot.records.push(nextRecord);
    markDataMutated_(false);
    return;
  }

  writeSheetRow_(sheetName, sheet, rowIndex + 2, headers, row);
  snapshot.records[rowIndex] = nextRecord;
  markDataMutated_(false);
}

function upsertRecordByComposite_(sheetName, keys, record) {
  var snapshot = getTableSnapshot_(sheetName);
  var sheet = snapshot.sheet;
  var headers = snapshot.headers;
  var matchedRowIndexes = [];
  var row = buildSheetRow_(sheetName, headers, record);
  var nextRecord = buildRecordFromRecord_(sheetName, headers, record);

  snapshot.records.forEach(function(item, index) {
    var isMatch = keys.every(function(key) {
      return normalizeCompositeKeyValue_(item[key]) === normalizeCompositeKeyValue_(record[key]);
    });

    if (isMatch) {
      matchedRowIndexes.push(index);
    }
  });

  if (!matchedRowIndexes.length) {
    writeSheetRow_(sheetName, sheet, sheet.getLastRow() + 1, headers, row);
    snapshot.records.push(nextRecord);
    markDataMutated_(false);
    return;
  }

  writeSheetRow_(sheetName, sheet, matchedRowIndexes[0] + 2, headers, row);
  snapshot.records[matchedRowIndexes[0]] = nextRecord;

  matchedRowIndexes
    .slice(1)
    .reverse()
    .forEach(function(rowIndex) {
      sheet.deleteRow(rowIndex + 2);
      snapshot.records.splice(rowIndex, 1);
    });

  markDataMutated_(false);
}

function normalizeCompositeKeyValue_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  return String(value || '').trim();
}

function deleteRecord_(sheetName, primaryKey, value) {
  var snapshot = getTableSnapshot_(sheetName);
  var sheet = snapshot.sheet;
  var rowIndex = snapshot.records.findIndex(function(item) {
    return String(item[primaryKey]) === String(value);
  });

  if (rowIndex === -1) {
    throw new Error('找不到可刪除的資料');
  }

  sheet.deleteRow(rowIndex + 2);
  snapshot.records.splice(rowIndex, 1);
  markDataMutated_(false);
}

function deleteRecordIfExists_(sheetName, primaryKey, value) {
  var snapshot = getTableSnapshot_(sheetName);
  var sheet = snapshot.sheet;
  if (!sheet || !snapshot.records.length) {
    return false;
  }

  var rowIndex = snapshot.records.findIndex(function(item) {
    return String(item[primaryKey]) === String(value);
  });

  if (rowIndex === -1) {
    return false;
  }

  sheet.deleteRow(rowIndex + 2);
  snapshot.records.splice(rowIndex, 1);
  markDataMutated_(false);
  return true;
}

function deleteRecordsByPredicate_(sheetName, predicate) {
  var snapshot = getTableSnapshot_(sheetName);
  var sheet = snapshot.sheet;
  var rowIndexes = [];

  snapshot.records.forEach(function(item, index) {
    if (predicate(item)) {
      rowIndexes.push(index + 2);
    }
  });

  if (!rowIndexes.length) {
    return;
  }

  rowIndexes.reverse().forEach(function(rowIndex) {
    sheet.deleteRow(rowIndex);
    snapshot.records.splice(rowIndex - 2, 1);
  });

  markDataMutated_(false);
}

function getSheetHeaders_(sheet) {
  if (!sheet) {
    return [];
  }

  return getTableSnapshot_(sheet.getName()).headers.slice();
}

function isTextColumn_(sheetName, columnName) {
  var columns = TEXT_COLUMNS_BY_SHEET[sheetName] || [];
  return columns.indexOf(String(columnName || '').trim()) !== -1;
}

function normalizeSheetTextValue_(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function buildSheetRow_(sheetName, headers, record) {
  return headers.map(function(header) {
    var value = record[header] !== undefined ? record[header] : '';
    return isTextColumn_(sheetName, header)
      ? buildSheetTextCellValue_(value)
      : value;
  });
}

function buildSheetTextCellValue_(value) {
  return "'" + normalizeSheetTextValue_(value);
}

function buildRecordFromRecord_(sheetName, headers, record) {
  var normalizedRecord = {};

  headers.forEach(function(header) {
    var value = record[header] !== undefined ? record[header] : '';
    normalizedRecord[header] = isTextColumn_(sheetName, header)
      ? normalizeSheetTextValue_(value)
      : value;
  });

  return normalizedRecord;
}

function writeSheetRow_(sheetName, sheet, rowNumber, headers, row) {
  var range = sheet.getRange(rowNumber, 1, 1, headers.length);

  ensureTextFormatForRow_(sheetName, range, headers);
  range.setValues([row]);
}

function ensureTextFormatForRow_(sheetName, range, headers) {
  headers.forEach(function(header, index) {
    if (!isTextColumn_(sheetName, header)) {
      return;
    }

    range.getCell(1, index + 1).setNumberFormat('@');
  });
}

function beginRequestContext_() {
  REQUEST_CONTEXT_ = {
    tables: {},
    mutated: false,
  };
}

function endRequestContext_() {
  if (REQUEST_CONTEXT_ && REQUEST_CONTEXT_.mutated) {
    bumpDataVersion_();
  }

  REQUEST_CONTEXT_ = null;
}

function markDataMutated_(clearTables) {
  if (!REQUEST_CONTEXT_) {
    bumpDataVersion_();
    return;
  }

  REQUEST_CONTEXT_.mutated = true;
  if (clearTables) {
    REQUEST_CONTEXT_.tables = {};
  }
}

function getCachedDataset_(cacheKey, builder, ttlSeconds) {
  var cache = CacheService.getScriptCache();
  var version = getDataVersion_();
  var resolvedTtl = Math.max(Number(ttlSeconds || 0), 1);
  var namespacedKey = [cacheKey, version].join(':');
  var cachedValue = null;

  try {
    cachedValue = cache.get(namespacedKey);
    if (cachedValue) {
      return JSON.parse(cachedValue);
    }
  } catch (error) {
    cachedValue = null;
  }

  var value = builder();

  try {
    cache.put(namespacedKey, JSON.stringify(value), resolvedTtl);
  } catch (error) {
    // 資料量超過 CacheService 限制時直接退回即時計算結果。
  }

  return value;
}

function getDataVersion_() {
  var properties = PropertiesService.getScriptProperties();
  var currentValue = String(properties.getProperty(DATA_VERSION_PROPERTY) || '').trim();

  if (currentValue) {
    return currentValue;
  }

  currentValue = String(Date.now());
  properties.setProperty(DATA_VERSION_PROPERTY, currentValue);
  return currentValue;
}

function bumpDataVersion_() {
  PropertiesService.getScriptProperties().setProperty(
    DATA_VERSION_PROPERTY,
    [String(Date.now()), String(Math.floor(Math.random() * 1000000))].join('-')
  );
}

function getTableSnapshot_(sheetName) {
  if (REQUEST_CONTEXT_ && REQUEST_CONTEXT_.tables[sheetName]) {
    return REQUEST_CONTEXT_.tables[sheetName];
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  var snapshot = {
    sheet: sheet,
    headers: [],
    records: [],
  };

  if (sheet && sheet.getLastColumn() > 0) {
    var lastRow = sheet.getLastRow();
    var lastColumn = sheet.getLastColumn();
    var range = sheet.getRange(1, 1, Math.max(lastRow, 1), lastColumn);
    var rawValues = range.getValues();
    var displayValues = hasTextColumns_(sheetName) ? range.getDisplayValues() : null;
    snapshot.headers = rawValues[0] || [];

    for (var rowIndex = 1; rowIndex < rawValues.length; rowIndex += 1) {
      var row = rawValues[rowIndex];
      if (row.join('') === '') {
        continue;
      }

      snapshot.records.push(buildRecordFromSourceRow_(sheetName, snapshot.headers, row, displayValues ? displayValues[rowIndex] : null));
    }
  }

  if (REQUEST_CONTEXT_) {
    REQUEST_CONTEXT_.tables[sheetName] = snapshot;
  }

  return snapshot;
}

function hasTextColumns_(sheetName) {
  return Boolean((TEXT_COLUMNS_BY_SHEET[sheetName] || []).length);
}

function buildRecordFromSheetRow_(sheetName, headers, row) {
  return buildRecordFromSourceRow_(sheetName, headers, row, row);
}

function buildRecordFromSourceRow_(sheetName, headers, row, displayRow) {
  var record = {};
  headers.forEach(function(header, index) {
    record[header] = isTextColumn_(sheetName, header)
      ? normalizeSheetTextValue_(displayRow ? displayRow[index] : row[index])
      : row[index];
  });
  return record;
}

function parseRequestBody_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return {};
  }
  return JSON.parse(e.postData.contents);
}

function getRequestValue_(e, key) {
  return e && e.parameter ? e.parameter[key] : '';
}

function verifyAdminAccess_(adminUserId) {
  validateRequired_(adminUserId, 'adminUserId');

  var normalizedUserId = String(adminUserId || '').trim();
  var approvedSuperAdmin = findApprovedSuperAdmin_(normalizedUserId);

  var adminUsers = getTableRecords_(SHEETS.adminUsers).map(normalizeAdminUser_);
  var adminUser = adminUsers.find(function(item) {
    return item.userId === normalizedUserId;
  });

  if (approvedSuperAdmin) {
    return buildAdminIdentityFromSuperAdmin_(approvedSuperAdmin, adminUser);
  }

  if (!adminUser) {
    throw new Error('找不到管理員登入紀錄，請先使用 LINE 登入');
  }

  if (!isAdminApproved_(adminUser.status)) {
    if (normalizeAdminStatus_(adminUser.status) === STATUS_PENDING) {
      throw new Error('管理員帳號待審核，尚不可使用後台');
    }

    throw new Error(adminUser.note || '此管理員帳號目前不可使用後台');
  }

  return adminUser;
}

function verifyTechnicianAccess_(technicianUserId) {
  validateRequired_(technicianUserId, 'technicianUserId');

  var technicians = getTableRecords_(SHEETS.technicians).map(normalizeTechnician_);
  var technician = technicians.find(function(item) {
    return item.lineUserId === String(technicianUserId || '').trim();
  });

  if (!technician) {
    throw new Error('找不到技師登入紀錄，請先使用 LINE 登入');
  }

  if (!isTechnicianApproved_(technician.status)) {
    if (normalizeTechnicianStatus_(technician.status, technician.lineUserId) === STATUS_PENDING) {
      throw new Error('技師帳號待審核，尚不可使用技師頁面');
    }

    throw new Error(technician.note || '此技師帳號目前不可使用技師頁面');
  }

  return technician;
}

function verifySuperAdminAccess_(adminUserId) {
  validateRequired_(adminUserId, 'adminUserId');

  var normalizedUserId = String(adminUserId || '').trim();
  var approvedSuperAdmin = findApprovedSuperAdmin_(normalizedUserId);

  if (approvedSuperAdmin) {
    return approvedSuperAdmin;
  }

  var storedSuperAdmin = getStoredSuperAdminUsers_().find(function(item) {
    return item.userId === normalizedUserId;
  });

  if (storedSuperAdmin) {
    if (normalizeAdminStatus_(storedSuperAdmin.status) === STATUS_PENDING) {
      throw new Error('此 LINE 帳號的最高管理員資格待審核，請在 SuperAdmins 工作表將 status 改為 已通過，或改用既有最高管理員登入。');
    }

    throw new Error(storedSuperAdmin.note || '此 LINE 帳號的最高管理員資格目前不可使用，請確認 SuperAdmins 工作表中的 status。');
  }

  throw new Error('此 LINE 帳號不是最高管理員。請先在 SuperAdmins 工作表新增此帳號，並將 status 設為 已通過，或改用既有最高管理員登入。');
}

function ensureAdminPermissionManager_(actorUserId) {
  var actor = verifyAdminAccess_(actorUserId);
  if (isSuperAdmin_(actor.userId) || actor.canManageAdmins) {
    return actor;
  }

  throw new Error('你沒有管理其他管理員權限的授權，請改由最高管理員設定');
}

function ensureAdminActionAccess_(adminUser, action) {
  var pageKey = ADMIN_ACTION_PAGE_MAP[action];
  if (!pageKey) {
    return adminUser;
  }

  return ensureAdminPageAccess_(adminUser, pageKey, action);
}

function ensureAdminPageAccess_(adminUser, pageKey, actionLabel) {
  if (hasAdminPagePermission_(adminUser, pageKey)) {
    return adminUser;
  }

  throw new Error('你目前沒有「' + getAdminPageLabel_(pageKey) + '」頁面的權限，無法執行 ' + String(actionLabel || '此操作') + '。');
}

function ensureAdminStatusReviewer_(actorUserId) {
  var approvedSuperAdmin = findApprovedSuperAdmin_(actorUserId);
  if (approvedSuperAdmin) {
    return approvedSuperAdmin;
  }

  var adminUsers = getTableRecords_(SHEETS.adminUsers).map(normalizeAdminUser_);
  var actor = adminUsers.find(function(item) {
    return item.userId === String(actorUserId || '').trim();
  });

  if (!actor) {
    throw new Error('找不到管理員登入紀錄，請先使用 LINE 登入');
  }

  if (!isAdminApproved_(actor.status)) {
    if (normalizeAdminStatus_(actor.status) === STATUS_PENDING) {
      throw new Error('管理員帳號待審核，尚不可修改其他管理員的審核狀態');
    }

    throw new Error(actor.note || '此管理員帳號目前不可修改其他管理員的審核狀態');
  }

  if (actor.canManageAdmins) {
    return actor;
  }

  throw new Error('你沒有管理其他管理員審核狀態的授權，請由最高管理員在 superadmin 設定。');
}

function normalizeService_(item) {
  return {
    serviceId: String(item.serviceId || ''),
    name: String(item.name || ''),
    durationMinutes: Number(item.durationMinutes || 0),
    price: Number(item.price || 0),
    active: toBoolean_(item.active),
    updatedAt: String(item.updatedAt || ''),
    category: normalizeCategoryValue_(item.category),
  };
}

function normalizeCategoryValue_(value) {
  var text = String(value || '').trim();
  return text || '未分類';
}

function normalizeTechnician_(item) {
  var lineUserId = String(item.lineUserId || '').trim();
  return {
    technicianId: String(item.technicianId || ''),
    name: String(item.name || ''),
    serviceIds: String(item.serviceIds || '')
      .split(',')
      .map(function(value) {
        return value.trim();
      })
      .filter(String),
    startTime: normalizeTimeString_(item.startTime || '09:00'),
    endTime: normalizeTimeString_(item.endTime || '18:00'),
    active: toBoolean_(item.active),
    updatedAt: String(item.updatedAt || ''),
    lineUserId: lineUserId,
    userId: lineUserId,
    profileDisplayName: String(item.profileDisplayName || '').trim() || String(item.name || '').trim() || DEFAULT_DISPLAY_NAME_TECHNICIAN,
    displayName: String(item.profileDisplayName || '').trim() || String(item.name || '').trim() || DEFAULT_DISPLAY_NAME_TECHNICIAN,
    pictureUrl: String(item.pictureUrl || '').trim(),
    status: normalizeTechnicianStatus_(item.reviewStatus, lineUserId),
    note: String(item.reviewNote || '').trim(),
    lastLoginAt: String(item.lastLoginAt || ''),
  };
}

function normalizeSchedule_(item) {
  return {
    scheduleId: String(item.scheduleId || ''),
    technicianId: String(item.technicianId || ''),
    date: normalizeDateString_(item.date),
    startTime: normalizeTimeString_(item.startTime),
    endTime: normalizeTimeString_(item.endTime),
    isWorking: toBoolean_(item.isWorking),
    updatedAt: String(item.updatedAt || ''),
  };
}

function normalizeReservation_(item) {
  var serviceIds = normalizeServiceIds_(item.serviceIds || item.serviceId);
  var assignmentType = normalizeReservationAssignmentType_(item.assignmentType, item.technicianId);
  return {
    reservationId: String(item.reservationId || ''),
    userId: String(item.userId || ''),
    userDisplayName: String(item.userDisplayName || ''),
    customerName: String(item.customerName || ''),
    phone: normalizePhoneValue_(item.phone),
    technicianId: String(item.technicianId || ''),
    assignmentType: assignmentType,
    serviceId: String(item.serviceId || ''),
    serviceIds: serviceIds,
    date: normalizeDateString_(item.date),
    startTime: normalizeTimeString_(item.startTime),
    endTime: normalizeTimeString_(item.endTime),
    status: normalizeReservationStatus_(item.status || RESERVATION_STATUS_BOOKED),
    note: String(item.note || ''),
    createdAt: String(item.createdAt || ''),
  };
}

function normalizeUser_(item) {
  return {
    userId: String(item.userId || ''),
    displayName: String(item.displayName || '').trim() || DEFAULT_DISPLAY_NAME_USER,
    customerName: String(item.customerName || '').trim(),
    phone: normalizePhoneValue_(item.phone),
    pictureUrl: String(item.pictureUrl || '').trim(),
    status: normalizeUserStatus_(item.status),
    note: String(item.note || '').trim(),
    createdAt: String(item.createdAt || ''),
    updatedAt: String(item.updatedAt || ''),
    lastLoginAt: String(item.lastLoginAt || ''),
  };
}

function normalizeAdminUser_(item) {
  var userId = String(item.userId || '').trim();
  return {
    userId: userId,
    displayName: String(item.displayName || '').trim() || DEFAULT_DISPLAY_NAME_ADMIN,
    pictureUrl: String(item.pictureUrl || '').trim(),
    status: normalizeAdminStatus_(item.status),
    canManageAdmins: normalizeAdminPermissionValue_(item.canManageAdmins, item.status, userId),
    pagePermissions: normalizeStoredAdminPagePermissions_(item.pagePermissions, userId),
    isSuperAdmin: isSuperAdmin_(userId),
    note: String(item.note || '').trim(),
    createdAt: String(item.createdAt || ''),
    updatedAt: String(item.updatedAt || ''),
    lastLoginAt: String(item.lastLoginAt || ''),
  };
}

function normalizeSuperAdminUser_(item) {
  return {
    userId: String(item.userId || '').trim(),
    displayName: String(item.displayName || '').trim() || DEFAULT_DISPLAY_NAME_SUPER_ADMIN,
    pictureUrl: String(item.pictureUrl || '').trim(),
    status: normalizeAdminStatus_(item.status),
    note: String(item.note || '').trim(),
    createdAt: String(item.createdAt || ''),
    updatedAt: String(item.updatedAt || ''),
    lastLoginAt: String(item.lastLoginAt || ''),
    isSuperAdmin: true,
    canManageAdmins: true,
    pagePermissions: getAllAdminPagePermissions_(),
  };
}

function normalizeAdminPermissionValue_(value, status, userId) {
  var text = String(value || '').trim().toLowerCase();
  if (text === 'true' || text === '1' || text === 'yes') {
    return true;
  }

  if (text === 'false' || text === '0' || text === 'no') {
    return false;
  }

  return false;
}

function getAllAdminPagePermissions_() {
  return ADMIN_PAGE_KEYS.slice();
}

function getAdminPageLabel_(pageKey) {
  if (pageKey === 'service') {
    return '服務';
  }
  if (pageKey === 'technician') {
    return '技師';
  }
  if (pageKey === 'schedule') {
    return '班表';
  }
  if (pageKey === 'reservation') {
    return '預約';
  }
  if (pageKey === 'user') {
    return '用戶審核';
  }
  return String(pageKey || '頁面');
}

function normalizeAdminPagePermissionList_(value) {
  var rawList = [];

  if (Object.prototype.toString.call(value) === '[object Array]') {
    rawList = value;
  } else {
    var text = String(value || '').trim();
    if (!text || text === ADMIN_PAGE_PERMISSION_NONE) {
      rawList = [];
    } else {
      rawList = text.split(',');
    }
  }

  return ADMIN_PAGE_KEYS.filter(function(pageKey) {
    return rawList.some(function(item) {
      return String(item || '').trim() === pageKey;
    });
  });
}

function normalizeStoredAdminPagePermissions_(value, userId) {
  var text = String(value || '').trim();
  if (!text) {
    return [];
  }

  return normalizeAdminPagePermissionList_(text);
}

function serializeAdminPagePermissions_(value, userId) {
  var pagePermissions = normalizeAdminPagePermissionList_(value);
  return pagePermissions.length ? pagePermissions.join(',') : ADMIN_PAGE_PERMISSION_NONE;
}

function hasAdminPagePermission_(adminUser, pageKey) {
  if (!adminUser) {
    return false;
  }

  return (adminUser.pagePermissions || []).indexOf(String(pageKey || '').trim()) !== -1;
}

function normalizeAdminStatus_(value) {
  var status = String(value || '').trim();

  if (!status) {
    return STATUS_PENDING;
  }

  if (status === 'pending' || status === STATUS_PENDING) {
    return STATUS_PENDING;
  }

  if (status === 'approved' || status === STATUS_APPROVED) {
    return STATUS_APPROVED;
  }

  if (status === 'rejected' || status === STATUS_REJECTED) {
    return STATUS_REJECTED;
  }

  if (status === 'disabled' || status === STATUS_DISABLED) {
    return STATUS_DISABLED;
  }

  return status;
}

function isAdminApproved_(status) {
  return normalizeAdminStatus_(status) === STATUS_APPROVED;
}

function normalizeTechnicianStatus_(value, lineUserId) {
  var status = String(value || '').trim();
  var hasLineIdentity = Boolean(String(lineUserId || '').trim());

  if (!status) {
    return hasLineIdentity ? STATUS_PENDING : STATUS_UNLINKED;
  }

  if (status === 'unlinked' || status === STATUS_UNLINKED) {
    return STATUS_UNLINKED;
  }

  if (status === 'pending' || status === STATUS_PENDING) {
    return STATUS_PENDING;
  }

  if (status === 'approved' || status === STATUS_APPROVED) {
    return STATUS_APPROVED;
  }

  if (status === 'rejected' || status === STATUS_REJECTED) {
    return STATUS_REJECTED;
  }

  if (status === 'disabled' || status === STATUS_DISABLED) {
    return STATUS_DISABLED;
  }

  return status;
}

function isTechnicianApproved_(status) {
  return normalizeTechnicianStatus_(status, 'linked') === STATUS_APPROVED;
}

function normalizeUserStatus_(value) {
  var status = String(value || '').trim();

  if (!status) {
    return STATUS_DRAFT;
  }

  if (status === 'draft' || status === STATUS_DRAFT) {
    return STATUS_DRAFT;
  }

  if (status === 'pending' || status === STATUS_PENDING) {
    return STATUS_PENDING;
  }

  if (status === 'approved' || status === STATUS_APPROVED) {
    return STATUS_APPROVED;
  }

  if (status === 'rejected' || status === STATUS_REJECTED) {
    return STATUS_REJECTED;
  }

  if (status === 'disabled' || status === STATUS_DISABLED) {
    return STATUS_DISABLED;
  }

  return status;
}

function isUserApproved_(status) {
  return normalizeUserStatus_(status) === STATUS_APPROVED;
}

function isBootstrapAdmin_(userId) {
  return parseCsvProperty_('ADMIN_APPROVED_LINE_USER_IDS').indexOf(String(userId || '').trim()) !== -1;
}

function isSuperAdmin_(userId) {
  var normalizedUserId = String(userId || '').trim();
  var resolvedSuperAdmins = getApprovedSuperAdminUsers_();
  return resolvedSuperAdmins.some(function(item) {
    return item.userId === normalizedUserId;
  });
}

function isConfiguredSuperAdmin_(userId) {
  var normalizedUserId = String(userId || '').trim();
  var configuredSuperAdmins = parseCsvProperty_('SUPER_ADMIN_LINE_USER_IDS');
  if (configuredSuperAdmins.length) {
    return configuredSuperAdmins.indexOf(normalizedUserId) !== -1;
  }

  return isBootstrapAdmin_(normalizedUserId);
}

function getStoredSuperAdminUsers_() {
  return getTableRecords_(SHEETS.superAdmins).map(normalizeSuperAdminUser_);
}

function getApprovedSuperAdminUsers_() {
  return getStoredSuperAdminUsers_().filter(function(item) {
    return isAdminApproved_(item.status);
  });
}

function getResolvedSuperAdminUsers_() {
  return getStoredSuperAdminUsers_();
}

function findResolvedSuperAdmin_(userId) {
  var normalizedUserId = String(userId || '').trim();
  return getResolvedSuperAdminUsers_().find(function(item) {
    return item.userId === normalizedUserId;
  }) || null;
}

function findApprovedSuperAdmin_(userId) {
  var normalizedUserId = String(userId || '').trim();
  return getApprovedSuperAdminUsers_().find(function(item) {
    return item.userId === normalizedUserId;
  }) || null;
}

function buildAdminIdentityFromSuperAdmin_(superAdminUser, adminUser) {
  var normalizedAdminUserId = String(superAdminUser.userId || adminUser && adminUser.userId || '').trim();
  var resolvedCanManageAdmins = normalizeAdminPermissionValue_(adminUser && adminUser.canManageAdmins, adminUser && adminUser.status, normalizedAdminUserId);
  var resolvedPagePermissions = normalizeStoredAdminPagePermissions_(adminUser && adminUser.pagePermissions, normalizedAdminUserId);

  return {
    userId: normalizedAdminUserId,
    displayName: String(superAdminUser.displayName || adminUser && adminUser.displayName || DEFAULT_DISPLAY_NAME_SUPER_ADMIN).trim() || DEFAULT_DISPLAY_NAME_SUPER_ADMIN,
    pictureUrl: String(superAdminUser.pictureUrl || adminUser && adminUser.pictureUrl || '').trim(),
    status: normalizeAdminStatus_(superAdminUser.status || adminUser && adminUser.status || STATUS_APPROVED),
    canManageAdmins: resolvedCanManageAdmins,
    pagePermissions: resolvedPagePermissions,
    isSuperAdmin: true,
    note: String(superAdminUser.note || adminUser && adminUser.note || '').trim(),
    createdAt: String(superAdminUser.createdAt || adminUser && adminUser.createdAt || ''),
    updatedAt: String(superAdminUser.updatedAt || adminUser && adminUser.updatedAt || ''),
    lastLoginAt: String(superAdminUser.lastLoginAt || adminUser && adminUser.lastLoginAt || ''),
  };
}

function migrateLegacySuperAdmins_() {
  var adminSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.adminUsers);
  if (!adminSheet || adminSheet.getLastRow() < 2) {
    return;
  }

  var headers = getSheetHeaders_(adminSheet);
  var legacyIndex = headers.indexOf('isSuperAdmin');
  if (legacyIndex === -1) {
    return;
  }

  getTableRecords_(SHEETS.adminUsers)
    .filter(function(item) {
      return normalizeRawBoolean_(item.isSuperAdmin);
    })
    .forEach(function(item) {
      var normalizedRecord = normalizeAdminUser_(item);
      var superAdminRecord = {
        userId: normalizedRecord.userId,
        displayName: normalizedRecord.displayName,
        pictureUrl: normalizedRecord.pictureUrl,
        status: normalizedRecord.status,
        note: normalizedRecord.note,
        createdAt: normalizedRecord.createdAt,
        updatedAt: normalizedRecord.updatedAt,
        lastLoginAt: normalizedRecord.lastLoginAt,
      };

      upsertRecord_(SHEETS.superAdmins, 'userId', superAdminRecord);
    });
}

function normalizeRawBoolean_(value) {
  var text = String(value || '').trim().toLowerCase();
  return text === 'true' || text === '1' || text === 'yes' || text === 'on';
}

function ensureApprovedAdminRemains_(excludedUserId) {
  var approvedCount = getTableRecords_(SHEETS.adminUsers)
    .map(normalizeAdminUser_)
    .filter(function(item) {
      return item.userId !== String(excludedUserId || '').trim() && isAdminApproved_(item.status);
    })
    .length;

  if (approvedCount) {
    return;
  }

  var approvedSuperAdminCount = getApprovedSuperAdminUsers_().length;
  if (approvedSuperAdminCount) {
    return;
  }

  throw new Error('至少需保留一位已通過的管理員或最高管理員');
}

function parseCsvProperty_(propertyName) {
  return String(PropertiesService.getScriptProperties().getProperty(propertyName) || '')
    .split(',')
    .map(function(item) {
      return String(item || '').trim();
    })
    .filter(String);
}

function normalizeReservationStatus_(value) {
  var status = String(value || '').trim();

  if (!status) {
    return RESERVATION_STATUS_BOOKED;
  }

  if (status === 'booked' || status === RESERVATION_STATUS_BOOKED) {
    return RESERVATION_STATUS_BOOKED;
  }

  if (status === 'completed' || status === RESERVATION_STATUS_COMPLETED) {
    return RESERVATION_STATUS_COMPLETED;
  }

  if (status === 'cancelled' || status === RESERVATION_STATUS_CANCELLED) {
    return RESERVATION_STATUS_CANCELLED;
  }

  return status;
}

function normalizeReservationAssignmentType_(value, technicianId) {
  var assignmentType = String(value || '').trim();
  if (assignmentType) {
    return assignmentType;
  }

  if (!String(technicianId || '').trim()) {
    return ASSIGNMENT_TYPE_ON_SITE;
  }

  return '';
}

function getReservationTechnicianLabel_(reservation, technicianMap) {
  if (normalizeReservationAssignmentType_(reservation.assignmentType, reservation.technicianId) === ASSIGNMENT_TYPE_ON_SITE) {
    return ASSIGNMENT_TYPE_ON_SITE;
  }

  return technicianMap[reservation.technicianId] ? technicianMap[reservation.technicianId].name : '';
}

function isReservationCancelled_(status) {
  return normalizeReservationStatus_(status) === RESERVATION_STATUS_CANCELLED;
}

function getReservationOccupiedEndMinutes_(reservation, serviceMap) {
  var reservedStart = timeToMinutes_(reservation.startTime);
  var calculatedEnd = reservedStart + getReservationServices_(reservation, serviceMap).reduce(function(sum, service) {
    return sum + Number(service && service.durationMinutes ? service.durationMinutes : 0);
  }, 0);

  if (!reservation.endTime) {
    return calculatedEnd;
  }

  var storedEnd = timeToMinutes_(reservation.endTime);
  if (storedEnd <= reservedStart) {
    storedEnd += 24 * 60;
  }

  return Math.max(storedEnd, calculatedEnd);
}

function getShiftEndMinutes_(startTime, endTime) {
  var shiftStart = timeToMinutes_(startTime);
  var shiftEnd = String(endTime || '') === '23:59' ? 24 * 60 : timeToMinutes_(endTime);

  if (shiftEnd <= shiftStart) {
    shiftEnd += 24 * 60;
  }

  return shiftEnd;
}

function isOvernightShift_(startTime, endTime) {
  return getShiftEndMinutes_(startTime, endTime) > 24 * 60;
}

function addDaysToDateString_(dateText, offsetDays) {
  var baseDate = new Date(String(dateText) + 'T00:00:00');
  baseDate.setDate(baseDate.getDate() + Number(offsetDays || 0));
  return normalizeDateString_(baseDate);
}

function getScheduleCoverageForDate_(schedule, actualDate) {
  var scheduleDate = normalizeDateString_(schedule.date);
  var shiftStart = timeToMinutes_(schedule.startTime);
  var shiftEnd = getShiftEndMinutes_(schedule.startTime, schedule.endTime);

  if (scheduleDate === actualDate) {
    return {
      start: shiftStart,
      end: shiftEnd,
    };
  }

  if (isOvernightShift_(schedule.startTime, schedule.endTime) && addDaysToDateString_(scheduleDate, 1) === actualDate) {
    return {
      start: 0,
      end: shiftEnd - 24 * 60,
    };
  }

  return null;
}

function getReservationCoverageForDate_(reservation, serviceMap, actualDate) {
  var reservationDate = normalizeDateString_(reservation.date);
  var reservationStart = timeToMinutes_(reservation.startTime);
  var reservationEnd = getReservationOccupiedEndMinutes_(reservation, serviceMap);

  if (reservationDate === actualDate) {
    return {
      start: reservationStart,
      end: reservationEnd,
    };
  }

  if (addDaysToDateString_(reservationDate, 1) === actualDate && reservationEnd > 24 * 60) {
    return {
      start: 0,
      end: reservationEnd - 24 * 60,
    };
  }

  return null;
}

function evaluateReservationForTechnician_(options) {
  var technicianId = String(options.technicianId || '');
  var reservationDate = normalizeDateString_(options.reservationDate);
  var reservationStart = Number(options.reservationStart || 0);
  var reservationEnd = Number(options.reservationEnd || 0);
  var schedules = (options.schedules || []).filter(function(item) {
    return item.technicianId === technicianId && toBoolean_(item.isWorking);
  });
  var reservations = options.reservations || [];
  var serviceMap = options.serviceMap || {};
  var ignoreReservationId = String(options.ignoreReservationId || '');
  var hasSchedule = false;
  var withinScheduleWindow = false;
  var matchedSchedule = null;

  schedules.some(function(schedule) {
    var coverage = getScheduleCoverageForDate_(schedule, reservationDate);
    if (!coverage) {
      return false;
    }

    hasSchedule = true;

    if (reservationStart < coverage.start || reservationEnd > coverage.end) {
      return false;
    }

    withinScheduleWindow = true;

    var nextDate = addDaysToDateString_(reservationDate, 1);
    var hasConflict = reservations.some(function(item) {
      if (item.reservationId === ignoreReservationId || item.technicianId !== technicianId || isReservationCancelled_(item.status)) {
        return false;
      }

      var reservationCoverage = getReservationCoverageForDate_(item, serviceMap, reservationDate);
      if (reservationCoverage) {
        return reservationStart < reservationCoverage.end && reservationCoverage.start < reservationEnd;
      }

      // 跨日衝突偵測：新預約跨午夜時，檢查隔日已有的預約
      if (normalizeDateString_(item.date) === nextDate) {
        var itemStart = timeToMinutes_(item.startTime) + 24 * 60;
        var itemEnd = getReservationOccupiedEndMinutes_(item, serviceMap) + 24 * 60;
        return reservationStart < itemEnd && itemStart < reservationEnd;
      }

      return false;
    });

    if (hasConflict) {
      return false;
    }

    matchedSchedule = schedule;
    return true;
  });

  if (matchedSchedule) {
    return {
      ok: true,
      schedule: matchedSchedule,
    };
  }

  if (!hasSchedule) {
    return { ok: false, reason: 'no-schedule' };
  }

  if (!withinScheduleWindow) {
    return { ok: false, reason: 'out-of-range' };
  }

  return { ok: false, reason: 'conflict' };
}

function normalizeServiceIds_(value) {
  if (Array.isArray(value)) {
    return value.map(function(item) {
      return String(item || '').trim();
    }).filter(function(item, index, list) {
      return item && list.indexOf(item) === index;
    });
  }

  return String(value || '').split(',').map(function(item) {
    return item.trim();
  }).filter(function(item, index, list) {
    return item && list.indexOf(item) === index;
  });
}

function getServicesByIds_(serviceIds, serviceMap) {
  return normalizeServiceIds_(serviceIds).map(function(serviceId) {
    return serviceMap[serviceId];
  }).filter(Boolean);
}

function getReservationServices_(reservation, serviceMap) {
  return getServicesByIds_(reservation.serviceIds || reservation.serviceId, serviceMap);
}

/**
 * Enrich a single reservation with computed display fields.
 * Centralizes the duplicated serviceName/totalDuration/totalPrice
 * enrichment pattern used in getAdminData_ and getTechnicianData_.
 */
function enrichReservation_(item, serviceMap, technicianMap, userMap) {
  var services = getReservationServices_(item, serviceMap);
  item.serviceName = services.map(function(s) { return s.name; }).join(SERVICE_NAME_SEPARATOR);
  item.totalDurationMinutes = services.reduce(function(sum, s) { return sum + Number(s.durationMinutes || 0); }, 0);
  item.totalPrice = services.reduce(function(sum, s) { return sum + Number(s.price || 0); }, 0);
  if (technicianMap) {
    item.technicianName = getReservationTechnicianLabel_(item, technicianMap);
  }
  if (userMap) {
    item.userStatus = userMap[item.userId] ? userMap[item.userId].status : '';
  }
  return item;
}

/**
 * Sanitize user-provided text to prevent Google Sheets formula injection.
 * Strips leading =, +, -, @ characters that Sheets interprets as formulas.
 */
function sanitizeTextInput_(value) {
  var text = String(value || '').trim();
  return text.replace(/^[=+\-@]+/, '');
}

function normalizeDateString_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(value || '');
}

function normalizeTimeString_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'HH:mm');
  }
  var text = String(value || '');
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(text)) {
    return text.slice(0, 5);
  }
  return text;
}

function normalizePhone_(value, isRequired) {
  var normalized = normalizePhoneValue_(value);

  if (!normalized) {
    if (isRequired) {
      throw new Error('phone is required');
    }
    return '';
  }

  if (!/^[0-9+\-()# ]+$/.test(normalized)) {
    throw new Error('電話號碼只能包含數字與常見電話符號（+ - ( ) # 空白）');
  }

  if (!/[0-9]/.test(normalized)) {
    throw new Error('電話號碼至少需要包含一個數字');
  }

  return normalized;
}

function normalizePhoneValue_(value) {
  return String(value || '')
    .replace(/[０-９]/g, function(char) {
      return String.fromCharCode(char.charCodeAt(0) - 65248);
    })
    .replace(/＋/g, '+')
    .replace(/－/g, '-')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/＃/g, '#')
    .replace(/[\u3000\t\n\r]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function jsonResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function toBoolean_(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  return String(value).toLowerCase() === 'true' || String(value).toLowerCase() === 'on';
}

function validateRequired_(value, fieldName) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error(fieldName + ' is required');
  }
}

function indexBy_(items, key) {
  return items.reduce(function(result, item) {
    result[item[key]] = item;
    return result;
  }, {});
}

function timeToMinutes_(timeText) {
  var parts = String(timeText).split(':');
  return Number(parts[0]) * 60 + Number(parts[1]);
}

function minutesToTime_(totalMinutes) {
  var normalizedMinutes = ((Number(totalMinutes) % (24 * 60)) + (24 * 60)) % (24 * 60);
  var hours = Math.floor(normalizedMinutes / 60);
  var minutes = normalizedMinutes % 60;
  return pad2_(hours) + ':' + pad2_(minutes);
}

function pad2_(value) {
  return ('0' + value).slice(-2);
}

function createId_(prefix) {
  return prefix + '-' + Utilities.getUuid().slice(0, 8);
}

function toIsoString_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
}
