Component({
  properties: {
    visible: Boolean,
    searchType: {
      type: String,
      value: 'book'
    },
    title: String,
    placeholder: String,
    query: String,
    loading: Boolean,
    results: {
      type: Array,
      value: []
    }
  },

  methods: {
    onSearchInput(e) {
      this.triggerEvent('input', { value: e.detail.value });
    },

    onSearchConfirm() {
      this.triggerEvent('confirm');
    },

    clearSearch() {
      this.triggerEvent('clear');
    },

    switchSearchType(e) {
      const type = e.currentTarget.dataset.type;
      this.triggerEvent('switchtype', { type });
    },

    onPickResult(e) {
      this.triggerEvent('pick', e.currentTarget.dataset);
    },

    closeSearch() {
      this.triggerEvent('close');
    }
  }
});
