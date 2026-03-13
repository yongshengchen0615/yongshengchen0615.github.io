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

function doGet(e) {
  try {
    initializeSheets_();
    var action = getRequestValue_(e, 'action');

    if (action === 'publicData') {
      return jsonResponse_({ ok: true, data: getPublicData_() });
    }

    if (action === 'adminData') {
      verifyAdminAccess_(getRequestValue_(e, 'adminUserId'));
      return jsonResponse_({ ok: true, data: getAdminData_() });
    }

    if (action === 'superAdminData') {
      verifySuperAdminAccess_(getRequestValue_(e, 'adminUserId'));
      return jsonResponse_({ ok: true, data: getSuperAdminData_() });
    }

    return jsonResponse_({ ok: true, message: 'Beauty reservation GAS API is running.' });
  } catch (error) {
    return jsonResponse_({ ok: false, message: error.message });
  }
}

function doPost(e) {
  try {
    initializeSheets_();
    var body = parseRequestBody_(e);
    var action = body.action;

    if (action === 'syncLineUser') {
      return jsonResponse_({ ok: true, data: syncLineUser_(body.payload || {}) });
    }

    if (action === 'syncAdminUser') {
      return jsonResponse_({ ok: true, data: syncAdminUser_(body.payload || {}) });
    }

    if (action === 'syncSuperAdminUser') {
      return jsonResponse_({ ok: true, data: syncSuperAdminUser_(body.payload || {}) });
    }

    if (action === 'submitUserApplication') {
      return jsonResponse_({ ok: true, data: submitUserApplication_(body.payload || {}) });
    }

    if (action === 'createReservation') {
      return jsonResponse_({ ok: true, data: createReservation_(body.payload || {}) });
    }

    if (action === 'updateAdminPermission') {
      verifySuperAdminAccess_(body.adminUserId);
      return jsonResponse_({ ok: true, data: updateAdminPermission_(body.payload || {}, body.adminUserId) });
    }

    if (action === 'reviewAdminUser') {
      verifySuperAdminAccess_(body.adminUserId);
      return jsonResponse_({ ok: true, data: reviewAdminUser_(body.payload || {}, body.adminUserId, true) });
    }

    if (action === 'deleteAdminUser') {
      verifySuperAdminAccess_(body.adminUserId);
      return jsonResponse_({ ok: true, data: deleteAdminUser_(body.payload || {}, body.adminUserId) });
    }

    verifyAdminAccess_(body.adminUserId);

    if (action === 'reviewUser') {
      return jsonResponse_({ ok: true, data: reviewUser_(body.payload || {}) });
    }

    if (action === 'deleteUser') {
      return jsonResponse_({ ok: true, data: deleteUser_(body.payload || {}) });
    }

    if (action === 'saveService') {
      return jsonResponse_({ ok: true, data: saveService_(body.payload || {}) });
    }

    if (action === 'saveTechnician') {
      return jsonResponse_({ ok: true, data: saveTechnician_(body.payload || {}) });
    }

    if (action === 'saveTechnicianServices') {
      return jsonResponse_({ ok: true, data: saveTechnicianServices_(body.payload || {}) });
    }

    if (action === 'saveSchedule') {
      return jsonResponse_({ ok: true, data: saveSchedule_(body.payload || {}) });
    }

    if (action === 'saveReservation') {
      return jsonResponse_({ ok: true, data: saveReservation_(body.payload || {}) });
    }

    if (action === 'deleteService') {
      return jsonResponse_({ ok: true, data: deleteService_(body.payload || {}) });
    }

    if (action === 'deleteTechnician') {
      return jsonResponse_({ ok: true, data: deleteTechnician_(body.payload || {}) });
    }

    if (action === 'deleteSchedule') {
      return jsonResponse_({ ok: true, data: deleteSchedule_(body.payload || {}) });
    }

    if (action === 'deleteReservation') {
      return jsonResponse_({ ok: true, data: deleteReservation_(body.payload || {}) });
    }

    throw new Error('Unsupported action: ' + action);
  } catch (error) {
    return jsonResponse_({ ok: false, message: error.message });
  }
}

function getPublicData_() {
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
}

function getAdminData_() {
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
    var reservationServices = getReservationServices_(item, serviceMap);
    item.serviceName = reservationServices.map(function(service) {
      return service.name;
    }).join('、');
    item.totalDurationMinutes = reservationServices.reduce(function(sum, service) {
      return sum + Number(service.durationMinutes || 0);
    }, 0);
    item.totalPrice = reservationServices.reduce(function(sum, service) {
      return sum + Number(service.price || 0);
    }, 0);
    item.technicianName = technicianMap[item.technicianId] ? technicianMap[item.technicianId].name : '';
    item.userStatus = userMap[item.userId] ? userMap[item.userId].status : '';
    return item;
  });

  return {
    adminUsers: adminUsers,
    services: services,
    technicians: technicians,
    schedules: schedules,
    users: users,
    reservations: reservations,
  };
}

function getSuperAdminData_() {
  return {
    adminUsers: getTableRecords_(SHEETS.adminUsers).map(normalizeAdminUser_),
    superAdmins: getResolvedSuperAdminUsers_(),
  };
}

function syncLineUser_(payload) {
  validateRequired_(payload.userId, 'userId');

  var userId = String(payload.userId || '').trim();
  var users = getTableRecords_(SHEETS.users).map(normalizeUser_);
  var existing = users.find(function(item) {
    return item.userId === userId;
  });
  var nowText = toIsoString_(new Date());
  var status = existing ? existing.status : '未送審核';

  var record = {
    userId: userId,
    displayName: String(payload.displayName || existing && existing.displayName || 'LINE 使用者').trim() || 'LINE 使用者',
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
  var adminUsers = getTableRecords_(SHEETS.adminUsers).map(normalizeAdminUser_);
  var existing = adminUsers.find(function(item) {
    return item.userId === userId;
  });

  var nowText = toIsoString_(new Date());
  var nextStatus = existing && existing.status
    ? existing.status
    : '待審核';
  var nextCanManageAdmins = isSuperAdmin_(userId)
    ? true
    : existing && existing.canManageAdmins !== undefined
      ? normalizeAdminPermissionValue_(existing.canManageAdmins, existing.status, userId)
      : normalizeAdminPermissionValue_('', nextStatus, userId);

  var record = {
    userId: userId,
    displayName: String(payload.displayName || existing && existing.displayName || 'LINE 管理員').trim() || 'LINE 管理員',
    pictureUrl: String(payload.pictureUrl || existing && existing.pictureUrl || '').trim(),
    status: normalizeAdminStatus_(nextStatus),
    canManageAdmins: nextCanManageAdmins,
    note: existing ? existing.note : '',
    createdAt: existing ? existing.createdAt : nowText,
    updatedAt: nowText,
    lastLoginAt: nowText,
  };

  upsertRecord_(SHEETS.adminUsers, 'userId', record);
  return normalizeAdminUser_(record);
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
    displayName: String(payload.displayName || existing && existing.displayName || 'LINE 最高管理員').trim() || 'LINE 最高管理員',
    pictureUrl: String(payload.pictureUrl || existing && existing.pictureUrl || '').trim(),
    status: normalizeAdminStatus_(existing && existing.status ? existing.status : '待審核'),
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
  var nextStatus = '待審核';

  if (existing && (existing.status === '已通過' || existing.status === '已停用' || existing.status === '已拒絕')) {
    nextStatus = existing.status;
  }

  var record = {
    userId: userId,
    displayName: String(payload.displayName || existing && existing.displayName || 'LINE 使用者').trim() || 'LINE 使用者',
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
  if (!actorIsApprovedSuperAdmin && String(actorUserId || '').trim() === existing.userId && nextStatus !== '已通過') {
    throw new Error('不能將自己改成不可使用的管理員狀態');
  }

  if (existing.status === '已通過' && nextStatus !== '已通過') {
    ensureApprovedAdminRemains_(existing.userId);
  }

  var record = {
    userId: existing.userId,
    displayName: existing.displayName,
    pictureUrl: existing.pictureUrl,
    status: nextStatus,
    canManageAdmins: normalizeAdminPermissionValue_(existing.canManageAdmins, nextStatus, existing.userId),
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

  var canManageAdmins = isSuperAdmin_(existing.userId)
    ? true
    : toBoolean_(payload.canManageAdmins);

  var record = {
    userId: existing.userId,
    displayName: existing.displayName,
    pictureUrl: existing.pictureUrl,
    status: existing.status,
    canManageAdmins: canManageAdmins,
    note: String(payload.note || existing.note || '').trim(),
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
  var matchedEvaluation = null;

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
    matchedEvaluation = evaluation;
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

  var record = {
    reservationId: createId_('RES'),
    userId: user.userId,
    userDisplayName: user.displayName,
    customerName: String(payload.customerName || user.customerName).trim(),
    phone: normalizedPhone,
    technicianId: matchedTechnician.technicianId,
    serviceId: serviceIds.join(','),
    date: reservationDate,
    startTime: reservationStartTime,
    endTime: minutesToTime_(reservationEnd),
    status: '已預約',
    note: payload.note || '',
    createdAt: toIsoString_(new Date()),
  };

  appendRecord_(SHEETS.reservations, record);
  record.technicianName = matchedTechnician.name;
  return record;
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
  var status = normalizeReservationStatus_(payload.status || '已預約');
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
    customerName: String(payload.customerName).trim(),
    phone: normalizedPhone,
    technicianId: payload.technicianId,
    serviceId: serviceIds.join(','),
    date: normalizeDateString_(payload.date),
    startTime: normalizeTimeString_(payload.startTime),
    endTime: minutesToTime_(reservationEnd),
    status: status,
    note: payload.note || '',
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

  if (existing.status === '已通過') {
    ensureApprovedAdminRemains_(userId);
  }

  deleteRecord_(SHEETS.adminUsers, 'userId', userId);
  return { userId: userId };
}

function initializeSheets_() {
  ensureSheet_(SHEETS.config, ['key', 'value']);
  ensureSheet_(SHEETS.adminUsers, ['userId', 'displayName', 'pictureUrl', 'status', 'canManageAdmins', 'note', 'createdAt', 'updatedAt', 'lastLoginAt']);
  ensureSheet_(SHEETS.superAdmins, ['userId', 'displayName', 'pictureUrl', 'status', 'note', 'createdAt', 'updatedAt', 'lastLoginAt']);
  ensureSheet_(SHEETS.services, ['serviceId', 'name', 'durationMinutes', 'price', 'active', 'updatedAt', 'category']);
  ensureSheet_(SHEETS.technicians, ['technicianId', 'name', 'serviceIds', 'startTime', 'endTime', 'active', 'updatedAt']);
  ensureSheet_(SHEETS.schedules, ['scheduleId', 'technicianId', 'date', 'startTime', 'endTime', 'isWorking', 'updatedAt']);
  ensureSheet_(SHEETS.users, ['userId', 'displayName', 'customerName', 'phone', 'pictureUrl', 'status', 'note', 'createdAt', 'updatedAt', 'lastLoginAt']);
  ensureSheet_(SHEETS.reservations, ['reservationId', 'userId', 'userDisplayName', 'customerName', 'phone', 'technicianId', 'serviceId', 'date', 'startTime', 'endTime', 'status', 'note', 'createdAt']);
  ensurePlainTextColumns_(SHEETS.users, ['phone']);
  ensurePlainTextColumns_(SHEETS.reservations, ['phone']);
  migrateLegacySuperAdmins_();
}

function ensureSheet_(sheetName, headers) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) {
    sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet(sheetName);
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    var currentHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    var needsHeaderFix = headers.some(function(header, index) {
      return currentHeaders[index] !== header;
    });
    if (needsHeaderFix) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
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
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) {
    return [];
  }

  var values = sheet.getDataRange().getValues();
  var headers = values.shift();
  return values
    .filter(function(row) {
      return row.join('') !== '';
    })
    .map(function(row) {
      var record = {};
      headers.forEach(function(header, index) {
        record[header] = row[index];
      });
      return record;
    });
}

function appendRecord_(sheetName, record) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  var headers = getSheetHeaders_(sheet);
  var row = headers.map(function(header) {
    return record[header] !== undefined ? record[header] : '';
  });
  sheet.appendRow(row);
}

function upsertRecord_(sheetName, primaryKey, record) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  var headers = getSheetHeaders_(sheet);
  var data = getTableRecords_(sheetName);
  var rowIndex = data.findIndex(function(item) {
    return String(item[primaryKey]) === String(record[primaryKey]);
  });
  var row = headers.map(function(header) {
    return record[header] !== undefined ? record[header] : '';
  });

  if (rowIndex === -1) {
    sheet.appendRow(row);
    return;
  }

  sheet.getRange(rowIndex + 2, 1, 1, headers.length).setValues([row]);
}

function upsertRecordByComposite_(sheetName, keys, record) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  var headers = getSheetHeaders_(sheet);
  var data = getTableRecords_(sheetName);
  var matchedRowIndexes = [];
  var row = headers.map(function(header) {
    return record[header] !== undefined ? record[header] : '';
  });

  data.forEach(function(item, index) {
    var isMatch = keys.every(function(key) {
      return normalizeCompositeKeyValue_(item[key]) === normalizeCompositeKeyValue_(record[key]);
    });

    if (isMatch) {
      matchedRowIndexes.push(index);
    }
  });

  if (!matchedRowIndexes.length) {
    sheet.appendRow(row);
    return;
  }

  sheet.getRange(matchedRowIndexes[0] + 2, 1, 1, headers.length).setValues([row]);

  matchedRowIndexes
    .slice(1)
    .reverse()
    .forEach(function(rowIndex) {
      sheet.deleteRow(rowIndex + 2);
    });
}

function normalizeCompositeKeyValue_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  return String(value || '').trim();
}

function deleteRecord_(sheetName, primaryKey, value) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  var data = getTableRecords_(sheetName);
  var rowIndex = data.findIndex(function(item) {
    return String(item[primaryKey]) === String(value);
  });

  if (rowIndex === -1) {
    throw new Error('找不到可刪除的資料');
  }

  sheet.deleteRow(rowIndex + 2);
}

function deleteRecordIfExists_(sheetName, primaryKey, value) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) {
    return false;
  }

  var data = getTableRecords_(sheetName);
  var rowIndex = data.findIndex(function(item) {
    return String(item[primaryKey]) === String(value);
  });

  if (rowIndex === -1) {
    return false;
  }

  sheet.deleteRow(rowIndex + 2);
  return true;
}

function deleteRecordsByPredicate_(sheetName, predicate) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  var data = getTableRecords_(sheetName);
  var rowIndexes = [];

  data.forEach(function(item, index) {
    if (predicate(item)) {
      rowIndexes.push(index + 2);
    }
  });

  rowIndexes.reverse().forEach(function(rowIndex) {
    sheet.deleteRow(rowIndex);
  });
}

function getSheetHeaders_(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
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

  var adminUsers = getTableRecords_(SHEETS.adminUsers).map(normalizeAdminUser_);
  var adminUser = adminUsers.find(function(item) {
    return item.userId === String(adminUserId || '').trim();
  });

  if (!adminUser) {
    throw new Error('找不到管理員登入紀錄，請先使用 LINE 登入');
  }

  if (!isAdminApproved_(adminUser.status)) {
    if (normalizeAdminStatus_(adminUser.status) === '待審核') {
      throw new Error('管理員帳號待審核，尚不可使用後台');
    }

    throw new Error(adminUser.note || '此管理員帳號目前不可使用後台');
  }

  return adminUser;
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
    if (normalizeAdminStatus_(storedSuperAdmin.status) === '待審核') {
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
    if (normalizeAdminStatus_(actor.status) === '待審核') {
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
  return {
    reservationId: String(item.reservationId || ''),
    userId: String(item.userId || ''),
    userDisplayName: String(item.userDisplayName || ''),
    customerName: String(item.customerName || ''),
    phone: normalizePhoneValue_(item.phone),
    technicianId: String(item.technicianId || ''),
    serviceId: String(item.serviceId || ''),
    serviceIds: serviceIds,
    date: normalizeDateString_(item.date),
    startTime: normalizeTimeString_(item.startTime),
    endTime: normalizeTimeString_(item.endTime),
    status: normalizeReservationStatus_(item.status || '已預約'),
    note: String(item.note || ''),
    createdAt: String(item.createdAt || ''),
  };
}

function normalizeUser_(item) {
  return {
    userId: String(item.userId || ''),
    displayName: String(item.displayName || '').trim() || 'LINE 使用者',
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
    displayName: String(item.displayName || '').trim() || 'LINE 管理員',
    pictureUrl: String(item.pictureUrl || '').trim(),
    status: normalizeAdminStatus_(item.status),
    canManageAdmins: normalizeAdminPermissionValue_(item.canManageAdmins, item.status, userId),
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
    displayName: String(item.displayName || '').trim() || 'LINE 最高管理員',
    pictureUrl: String(item.pictureUrl || '').trim(),
    status: normalizeAdminStatus_(item.status),
    note: String(item.note || '').trim(),
    createdAt: String(item.createdAt || ''),
    updatedAt: String(item.updatedAt || ''),
    lastLoginAt: String(item.lastLoginAt || ''),
    isSuperAdmin: true,
    canManageAdmins: true,
  };
}

function normalizeAdminPermissionValue_(value, status, userId) {
  if (isSuperAdmin_(userId)) {
    return true;
  }

  var text = String(value || '').trim().toLowerCase();
  if (text === 'true' || text === '1' || text === 'yes') {
    return true;
  }

  if (text === 'false' || text === '0' || text === 'no') {
    return false;
  }

  return normalizeAdminStatus_(status) === '已通過';
}

function normalizeAdminStatus_(value) {
  var status = String(value || '').trim();

  if (!status) {
    return '待審核';
  }

  if (status === 'pending' || status === '待審核') {
    return '待審核';
  }

  if (status === 'approved' || status === '已通過') {
    return '已通過';
  }

  if (status === 'rejected' || status === '已拒絕') {
    return '已拒絕';
  }

  if (status === 'disabled' || status === '已停用') {
    return '已停用';
  }

  return status;
}

function isAdminApproved_(status) {
  return normalizeAdminStatus_(status) === '已通過';
}

function normalizeUserStatus_(value) {
  var status = String(value || '').trim();

  if (!status) {
    return '未送審核';
  }

  if (status === 'draft' || status === '未送審核') {
    return '未送審核';
  }

  if (status === 'pending' || status === '待審核') {
    return '待審核';
  }

  if (status === 'approved' || status === '已通過') {
    return '已通過';
  }

  if (status === 'rejected' || status === '已拒絕') {
    return '已拒絕';
  }

  if (status === 'disabled' || status === '已停用') {
    return '已停用';
  }

  return status;
}

function isUserApproved_(status) {
  return normalizeUserStatus_(status) === '已通過';
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
  return {
    userId: String(superAdminUser.userId || adminUser && adminUser.userId || '').trim(),
    displayName: String(superAdminUser.displayName || adminUser && adminUser.displayName || 'LINE 最高管理員').trim() || 'LINE 最高管理員',
    pictureUrl: String(superAdminUser.pictureUrl || adminUser && adminUser.pictureUrl || '').trim(),
    status: normalizeAdminStatus_(superAdminUser.status || adminUser && adminUser.status || '已通過'),
    canManageAdmins: true,
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
    return '已預約';
  }

  if (status === 'booked' || status === '已預約') {
    return '已預約';
  }

  if (status === 'completed' || status === '已完成') {
    return '已完成';
  }

  if (status === 'cancelled' || status === '已取消') {
    return '已取消';
  }

  return status;
}

function isReservationCancelled_(status) {
  return normalizeReservationStatus_(status) === '已取消';
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
