(function (root) {
  "use strict";

  var definitions = Object.create(null);
  var instances = Object.create(null);
  var resolving = [];

  function createError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  function normalizeName(value) {
    var name = String(value || "").trim();
    if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/i.test(name)) {
      throw createError(
        "INVALID_MODULE_NAME",
        "模組名稱格式不正確：" + (name || "(empty)")
      );
    }
    return name;
  }

  function define(nameValue, dependencyValues, factory) {
    var name = normalizeName(nameValue);
    var dependencies = Array.isArray(dependencyValues)
      ? dependencyValues.map(normalizeName)
      : [];

    if (typeof factory !== "function") {
      throw createError(
        "INVALID_MODULE_FACTORY",
        "模組 " + name + " 必須提供 factory function。"
      );
    }

    if (definitions[name]) {
      throw createError(
        "DUPLICATE_MODULE",
        "模組已重複註冊：" + name
      );
    }

    definitions[name] = Object.freeze({
      dependencies: Object.freeze(dependencies.slice()),
      factory: factory,
    });
  }

  function get(nameValue) {
    var name = normalizeName(nameValue);
    if (Object.prototype.hasOwnProperty.call(instances, name)) {
      return instances[name];
    }

    var definition = definitions[name];
    if (!definition) {
      throw createError("MODULE_NOT_FOUND", "找不到模組：" + name);
    }

    var cycleIndex = resolving.indexOf(name);
    if (cycleIndex >= 0) {
      var cycle = resolving.slice(cycleIndex).concat(name).join(" -> ");
      throw createError("MODULE_CYCLE", "模組相依形成循環：" + cycle);
    }

    resolving.push(name);
    try {
      var resolvedDependencies = definition.dependencies.map(get);
      var instance = definition.factory.apply(null, resolvedDependencies);
      if (instance === undefined || instance === null) {
        throw createError(
          "INVALID_MODULE_INSTANCE",
          "模組 " + name + " 沒有回傳可用實例。"
        );
      }
      instances[name] = instance;
      return instance;
    } finally {
      resolving.pop();
    }
  }

  function has(nameValue) {
    try {
      return Boolean(definitions[normalizeName(nameValue)]);
    } catch (_error) {
      return false;
    }
  }

  root.PersonaModules = Object.freeze({
    define: define,
    get: get,
    has: has,
  });
})(window);
