const SHEETS = {
  config: 'Config',
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
      verifyAdmin_(getRequestValue_(e, 'password'));
      return jsonResponse_({ ok: true, data: getAdminData_() });
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

    if (action === 'submitUserApplication') {
      return jsonResponse_({ ok: true, data: submitUserApplication_(body.payload || {}) });
    }

    if (action === 'createReservation') {
      return jsonResponse_({ ok: true, data: createReservation_(body.payload || {}) });
    }

    verifyAdmin_(body.password);

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
    services: services,
    technicians: technicians,
    schedules: schedules,
    users: users,
    reservations: reservations,
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

function createReservation_(payload) {
  validateRequired_(payload.customerName, 'customerName');
  validateRequired_(payload.phone, 'phone');
  validateRequired_(payload.technicianId, 'technicianId');
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
  var technician = technicianMap[payload.technicianId];
  var user = userMap[String(payload.userId || '').trim()];

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

  if (!technician || !toBoolean_(technician.active)) {
    throw new Error('技師不存在或未啟用');
  }

  serviceIds.forEach(function(serviceId) {
    var service = serviceMap[serviceId];
    if (!service || !toBoolean_(service.active)) {
      throw new Error('服務項目不存在或未啟用');
    }
    if (technician.serviceIds.indexOf(serviceId) === -1) {
      throw new Error('此技師不可服務所選的其中一個項目');
    }
  });

  var schedule = schedules.find(function(item) {
    return item.technicianId === payload.technicianId && item.date === payload.date;
  });

  if (!schedule || !toBoolean_(schedule.isWorking)) {
    throw new Error('該日期沒有可預約班表');
  }

  var serviceDuration = selectedServices.reduce(function(sum, service) {
    return sum + Number(service.durationMinutes || 0);
  }, 0);
  var reservationStart = timeToMinutes_(payload.startTime);
  var reservationEnd = reservationStart + serviceDuration;

  if (reservationStart < timeToMinutes_(schedule.startTime) || reservationEnd > getScheduleEndMinutes_(schedule.endTime)) {
    throw new Error('預約時段不在班表範圍內');
  }

  var hasConflict = reservations.some(function(item) {
    if (item.technicianId !== payload.technicianId || item.date !== payload.date || isReservationCancelled_(item.status)) {
      return false;
    }
    var existingStart = timeToMinutes_(item.startTime);
    var existingEnd = getReservationOccupiedEndMinutes_(item, serviceMap);
    return reservationStart < existingEnd && existingStart < reservationEnd;
  });

  if (hasConflict) {
    throw new Error('此時段已被預約，請重新選擇');
  }

  var record = {
    reservationId: createId_('RES'),
    userId: user.userId,
    userDisplayName: user.displayName,
    customerName: String(payload.customerName || user.customerName).trim(),
    phone: normalizedPhone,
    technicianId: payload.technicianId,
    serviceId: serviceIds.join(','),
    date: payload.date,
    startTime: payload.startTime,
    endTime: minutesToTime_(reservationEnd),
    status: '已預約',
    note: payload.note || '',
    createdAt: toIsoString_(new Date()),
  };

  appendRecord_(SHEETS.reservations, record);
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

  if (timeToMinutes_(technicianStartTime) >= timeToMinutes_(technicianEndTime)) {
    throw new Error('下班時間必須晚於上班時間');
  }

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

  if (timeToMinutes_(scheduleStartTime) >= timeToMinutes_(scheduleEndTime)) {
    throw new Error('下班時間必須晚於上班時間');
  }

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

    var schedule = schedules.find(function(item) {
      return item.technicianId === payload.technicianId && item.date === payload.date && toBoolean_(item.isWorking);
    });
    if (!schedule) {
      throw new Error('該日期沒有可預約班表');
    }

    if (reservationStart < timeToMinutes_(schedule.startTime) || reservationEnd > getScheduleEndMinutes_(schedule.endTime)) {
      throw new Error('預約時段不在班表範圍內');
    }

    var hasConflict = reservations.some(function(item) {
      if (item.reservationId === String(payload.reservationId || '')) {
        return false;
      }
      if (item.technicianId !== payload.technicianId || item.date !== payload.date || isReservationCancelled_(item.status)) {
        return false;
      }
      var existingStart = timeToMinutes_(item.startTime);
      var existingEnd = getReservationOccupiedEndMinutes_(item, serviceMap);
      return reservationStart < existingEnd && existingStart < reservationEnd;
    });

    if (hasConflict) {
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
    date: payload.date,
    startTime: payload.startTime,
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

  var linkedReservation = reservations.find(function(item) {
    return item.technicianId === technicianId && item.date === scheduleDate;
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

function initializeSheets_() {
  ensureSheet_(SHEETS.config, ['key', 'value']);
  ensureSheet_(SHEETS.services, ['serviceId', 'name', 'durationMinutes', 'price', 'active', 'updatedAt', 'category']);
  ensureSheet_(SHEETS.technicians, ['technicianId', 'name', 'serviceIds', 'startTime', 'endTime', 'active', 'updatedAt']);
  ensureSheet_(SHEETS.schedules, ['scheduleId', 'technicianId', 'date', 'startTime', 'endTime', 'isWorking', 'updatedAt']);
  ensureSheet_(SHEETS.users, ['userId', 'displayName', 'customerName', 'phone', 'pictureUrl', 'status', 'note', 'createdAt', 'updatedAt', 'lastLoginAt']);
  ensureSheet_(SHEETS.reservations, ['reservationId', 'userId', 'userDisplayName', 'customerName', 'phone', 'technicianId', 'serviceId', 'date', 'startTime', 'endTime', 'status', 'note', 'createdAt']);
  ensurePlainTextColumns_(SHEETS.users, ['phone']);
  ensurePlainTextColumns_(SHEETS.reservations, ['phone']);
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

function verifyAdmin_(password) {
  var adminPassword = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD') || 'admin1234';
  if (!password || password !== adminPassword) {
    throw new Error('管理密碼錯誤');
  }
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

  return Math.max(timeToMinutes_(reservation.endTime), calculatedEnd);
}

function getScheduleEndMinutes_(timeText) {
  if (String(timeText || '') === '23:59') {
    return 24 * 60;
  }

  return timeToMinutes_(timeText);
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
  var hours = Math.floor(totalMinutes / 60);
  var minutes = totalMinutes % 60;
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
