module.exports = {
  improve: 'apostrophe-doc-type-manager',
  construct: function(self, options) {
    if (!self.options.popularity) {
      return;
    }
    self.on('apostrophe-docs:beforeInsert', function(doc) {
      if (doc.type !== self.name) {
        return;
      }
      doc.popularity = 0;
    });
    const metrics = self.options.popularity.metrics;
    if (!metrics) {
      self.apos.utils.warn('The popularity feature is enabled for\n' + self.__meta.name + ' but there is no "metrics" subproperty.\n\nSpecify metrics to use this module effectively.');
      return;
    }
  }
};

