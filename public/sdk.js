(function() {
  'use strict';

  var Anykpi = function(config) {
    this.config = {
      endpoint: config.endpoint || '',
      workspaceId: config.workspaceId || 'live',
      apiKey: config.apiKey || '',
      debug: config.debug || false
    };
    this.user = null;
    
    if (this.config.debug) {
      console.log('[ANYKPI] Initialized', {
        endpoint: this.config.endpoint,
        workspaceId: this.config.workspaceId
      });
    }
  };

  Anykpi.prototype.identify = function(user) {
    this.user = user;
    this._send('/api/ingest/identify', {
      userId: user.userId,
      properties: user.properties || {},
      timestamp: new Date().toISOString()
    });
  };

  Anykpi.prototype.track = function(eventName, properties) {
    if (!this.user) {
      console.warn('[ANYKPI] track() called before identify()');
      return;
    }

    this._send('/api/ingest/event', {
      userId: this.user.userId,
      event: eventName,
      properties: properties || {},
      timestamp: new Date().toISOString()
    });
  };

  Anykpi.prototype._send = function(path, payload) {
    var url = this.config.endpoint + path;
    var body = {
      workspaceId: this.config.workspaceId,
      userId: payload.userId,
      event: payload.event,
      properties: payload.properties,
      timestamp: payload.timestamp
    };

    if (this.config.debug) {
      console.log('[ANYKPI] Sending', url);
    }

    if (typeof fetch !== 'undefined') {
      var headers = {
        'Content-Type': 'application/json'
      };
      if (this.config.apiKey) {
        headers.Authorization = 'Bearer ' + this.config.apiKey;
      }
      fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body)
      }).catch(function(error) {
        console.error('[ANYKPI] Failed to send event', error);
      });
    }
  };

  if (window.anykpi && window.anykpi.q) {
    var instance = new Anykpi(window.anykpi.config || {});
    
    window.anykpi.q.forEach(function(args) {
      var method = args[0];
      var params = Array.prototype.slice.call(args, 1);
      if (instance[method]) {
        instance[method].apply(instance, params);
      }
    });
    
    window.anykpi = instance;
  }

  window.Anykpi = Anykpi;
})();
