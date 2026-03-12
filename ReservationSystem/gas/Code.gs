const SHEETS = {
  config: 'Config',
  services: 'Services',
  technicians: 'Technicians',
  schedules: 'Schedules',
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

    if (action === 'createReservation') {
      return jsonResponse_({ ok: true, data: createReservation_(body.payload || {}) });
    }

    verifyAdmin_(body.password);

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
  var reservations = getTableRecords_(SHEETS.reservations).map(normalizeReservation_);
  var serviceMap = indexBy_(services, 'serviceId');
  var technicianMap = indexBy_(technicians, 'technicianId');

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
    return item;
  });

  return {
    services: services,
    technicians: technicians,
    schedules: schedules,
    reservations: reservations,
  };
}

function createReservation_(payload) {
  validateRequired_(payload.customerName, 'customerName');
  validateRequired_(payload.phone, 'phone');
  validateRequired_(payload.technicianId, 'technicianId');
  validateRequired_(payload.date, 'date');
  validateRequired_(payload.startTime, 'startTime');

  var services = getTableRecords_(SHEETS.services).map(normalizeService_);
  var technicians = getTableRecords_(SHEETS.technicians).map(normalizeTechnician_);
  var schedules = getTableRecords_(SHEETS.schedules).map(normalizeSchedule_);
  var reservations = getTableRecords_(SHEETS.reservations).map(normalizeReservation_);

  var serviceMap = indexBy_(services, 'serviceId');
  var technicianMap = indexBy_(technicians, 'technicianId');
  var serviceIds = normalizeServiceIds_(payload.serviceIds || payload.serviceId);
  var selectedServices = getServicesByIds_(serviceIds, serviceMap);
  var technician = technicianMap[payload.technicianId];

  if (!serviceIds.length) {
    throw new Error('請至少選擇一個服務項目');
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
    customerName: String(payload.customerName).trim(),
    phone: String(payload.phone).trim(),
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
  };

  upsertRecord_(SHEETS.services, 'serviceId', record);
  return record;
}

function saveTechnician_(payload) {
  validateRequired_(payload.name, 'name');

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

  if (timeToMinutes_(payload.startTime) >= timeToMinutes_(payload.endTime)) {
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
    return item.technicianId === payload.technicianId && item.date === payload.date;
  });

  var record = {
    scheduleId: existing && existing.scheduleId ? existing.scheduleId : createId_('SCH'),
    technicianId: payload.technicianId,
    date: payload.date,
    startTime: payload.startTime,
    endTime: payload.endTime,
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
    customerName: String(payload.customerName).trim(),
    phone: String(payload.phone).trim(),
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

function deleteReservation_(payload) {
  validateRequired_(payload.reservationId, 'reservationId');
  var reservationId = String(payload.reservationId);
  deleteRecord_(SHEETS.reservations, 'reservationId', reservationId);
  return { reservationId: reservationId };
}

function initializeSheets_() {
  ensureSheet_(SHEETS.config, ['key', 'value']);
  ensureSheet_(SHEETS.services, ['serviceId', 'name', 'durationMinutes', 'price', 'active', 'updatedAt']);
  ensureSheet_(SHEETS.technicians, ['technicianId', 'name', 'serviceIds', 'active', 'updatedAt']);
  ensureSheet_(SHEETS.schedules, ['scheduleId', 'technicianId', 'date', 'startTime', 'endTime', 'isWorking', 'updatedAt']);
  ensureSheet_(SHEETS.reservations, ['reservationId', 'customerName', 'phone', 'technicianId', 'serviceId', 'date', 'startTime', 'endTime', 'status', 'note', 'createdAt']);
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
  var rowIndex = data.findIndex(function(item) {
    return keys.every(function(key) {
      return String(item[key]) === String(record[key]);
    });
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
  };
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
    customerName: String(item.customerName || ''),
    phone: String(item.phone || ''),
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
