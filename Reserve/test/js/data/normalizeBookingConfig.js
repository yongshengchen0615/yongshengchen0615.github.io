// normalizeBookingConfig.js

export function normalizeBookingConfig(raw) {
    function unwrap(val) {
      if (typeof val === "object" && val !== null) {
        if ("$numberInt" in val) return Number(val["$numberInt"]);
        if ("$numberLong" in val) return Number(val["$numberLong"]);
        if ("$date" in val && "$numberLong" in val["$date"]) return new Date(Number(val["$date"]["$numberLong"]));
      }
      return val;
    }
  
    const weeklyOff = Array.isArray(raw.dateTypes?.weeklyOff)
      ? raw.dateTypes.weeklyOff.map(unwrap)
      : [];
  
    const services = {};
    for (const type in raw.services) {
      services[type] = {};
      for (const name in raw.services[type]) {
        const s = raw.services[type][name];
        services[type][name] = {
          type: s.type,
          time: unwrap(s.time),
          price: unwrap(s.price),
        };
      }
    }
  
    return {
      startTime: unwrap(raw.startTime),
      endTime: unwrap(raw.endTime),
      bufferMinutes: unwrap(raw.bufferMinutes),
      maxBookingDays: unwrap(raw.maxBookingDays),
      breakPeriods: raw.breakPeriods || [],
      dateTypes: {
        holiday: raw.dateTypes.holiday || [],
        blockedDay: raw.dateTypes.blockedDay || [],
        eventDay: raw.dateTypes.eventDay || [],
        halfDay: raw.dateTypes.halfDay || [],
        weeklyOff: weeklyOff
      },
      services
    };
  }
  