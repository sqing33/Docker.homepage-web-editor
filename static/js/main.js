const { createApp, ref, onMounted, nextTick, computed, watch } = Vue;
const { ElMessage, ElMessageBox } = ElementPlus;

const app = createApp({
  delimiters: ["[[", "]]"],
  setup() {
    const services = ref([]);
    const bookmarks = ref([]);
    const config = ref({ groups: [], layout: {} });
    const isLoading = ref(true);
    const addDialogVisible = ref(false);
    const addForm = ref({});
    const isEditMode = ref(false);
    const currentEditInfo = ref({});
    const fileInput = ref(null);

    const dockerDialogVisible = ref(false);
    const isDockerLoading = ref(false);
    const dockerContainers = ref([]);
    const dockerSearchQuery = ref("");

    const luckyDialogVisible = ref(false);
    const isLuckyLoading = ref(false);
    const luckyProxies = ref([]);
    const luckySearchQuery = ref("");

    const backgroundDialogVisible = ref(false);
    const isSavingBackground = ref(false);
    const isUploadingBackground = ref(false);
    const backgroundForm = ref({ image: "", saturate: 100, opacity: 100, blur: "" });
    const backgroundFileInput = ref(null);
    const backgroundList = ref([]);
    const blurOptions = ref([
      { value: "sm", label: "小 (sm)" },
      { value: "md", label: "中 (md)" },
      { value: "lg", label: "大 (lg)" },
      { value: "xl", label: "特大 (xl)" },
      { value: "2xl", label: "超大 (2xl)" },
      { value: "3xl", label: "极大 (3xl)" },
    ]);

    const serviceGroupNames = computed(() => services.value.map((g) => g.name));
    const bookmarkColumnNames = computed(() => bookmarks.value.map((c) => c.name));

    const filteredDockerContainers = computed(() => {
      if (!dockerSearchQuery.value) return dockerContainers.value;
      const query = dockerSearchQuery.value.toLowerCase();
      return dockerContainers.value.filter((c) => c.Name.toLowerCase().includes(query));
    });

    const filteredLuckyProxies = computed(() => {
      if (!luckySearchQuery.value) return luckyProxies.value;
      const query = luckySearchQuery.value.toLowerCase();
      return luckyProxies.value.filter((p) => p.Name.toLowerCase().includes(query) || p.Url.toLowerCase().includes(query));
    });

    // API
    const fetchConfig = async () => {
      try {
        const r = await fetch("/api/config");
        config.value = await r.json();
      } catch (e) {
        ElMessage.error("加载配置失败");
      }
    };
    const fetchItems = async (type) => {
      try {
        const response = await fetch(`/api/${type}s`);
        const data = await response.json();
        if (data.error) throw new Error(data.error);
        if (type === "service") {
          services.value = (data || []).map((g) => ({ name: Object.keys(g)[0], items: (Object.values(g)[0] || []).map((i) => ({ name: Object.keys(i)[0], ...Object.values(i)[0] })) }));
        } else {
          bookmarks.value = (data || []).map((c) => {
            const colName = Object.keys(c)[0];
            const cats = Object.values(c)[0] || [];
            const allItems = [];
            cats.forEach((catObj) => {
              const catName = Object.keys(catObj)[0];
              const items = Object.values(catObj)[0] || [];
              items.forEach((item) => {
                allItems.push({ ...item, _categoryName: catName });
              });
            });
            return { name: colName, items: allItems };
          });
        }
      } catch (error) {
        ElMessage.error(`加载 ${type} 失败: ${error.message}`);
      }
    };
    const fetchSettings = async () => {
      try {
        const response = await fetch("/api/settings");
        if (!response.ok) throw new Error("无法加载设置");
        const settings = await response.json();
        if (settings.background) {
          const defaults = { image: "", saturate: 100, opacity: 100, blur: "" };
          backgroundForm.value = { ...defaults, ...settings.background };
        }
      } catch (error) {
        console.error("加载背景设置失败:", error);
      }
    };
    const fetchAllData = async () => {
      isLoading.value = true;
      await Promise.all([fetchConfig(), fetchItems("service"), fetchItems("bookmark"), fetchSettings()]);
      isLoading.value = false;
      nextTick(initAllSortables);
    };
    const saveData = async (type) => {
      let dataToSave;
      if (type === "service") {
        dataToSave = services.value.map((g) => ({ [g.name]: g.items.map((i) => ({ [i.name]: (({ name, ...rest }) => rest)(i) })) }));
      } else {
        dataToSave = bookmarks.value.map((c) => {
          const cats = {};
          c.items.forEach((i) => {
            if (!cats[i._categoryName]) cats[i._categoryName] = [];
            const { href, abbr, icon } = i;
            const details = { href };
            if (abbr) details.abbr = abbr;
            if (icon) details.icon = icon;
            cats[i._categoryName].push(details);
          });
          return { [c.name]: Object.keys(cats).map((catName) => ({ [catName]: cats[catName] })) };
        });
      }
      try {
        const r = await fetch(`/api/${type}s`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dataToSave, null, 2) });
        const result = await r.json();
        if (!r.ok) throw new Error(result.error || "未知错误");
        ElMessage.success(`${type} 配置已成功保存！`);
      } catch (e) {
        ElMessage.error(`保存失败: ${e.message}`);
      }
    };

    // 拖拽
    const initAllSortables = () => {
      const opts = { animation: 150, ghostClass: "ghost" };
      const servicesEl = document.querySelector(".services-section");
      if (servicesEl)
        Sortable.create(servicesEl, {
          ...opts,
          handle: ".group-title",
          onEnd: (e) => {
            const [m] = services.value.splice(e.oldIndex, 1);
            services.value.splice(e.newIndex, 0, m);
            saveData("service");
          },
        });
      document.querySelectorAll('.sortable-container[data-type="service"]').forEach((el) => {
        Sortable.create(el, {
          ...opts,
          group: "service-items",
          onEnd: (e) => {
            const [m] = services.value[e.from.dataset.groupIndex].items.splice(e.oldIndex, 1);
            services.value[e.to.dataset.groupIndex].items.splice(e.newIndex, 0, m);
            saveData("service");
          },
        });
      });
      const bmColEl = document.querySelector('.sortable-container[data-type="bookmark-column"]');
      if (bmColEl)
        Sortable.create(bmColEl, {
          ...opts,
          handle: ".bookmarks-column-title",
          onEnd: (e) => {
            const [m] = bookmarks.value.splice(e.oldIndex, 1);
            bookmarks.value.splice(e.newIndex, 0, m);
            saveData("bookmark");
          },
        });
      document.querySelectorAll('.sortable-container[data-type="bookmark-item"]').forEach((el) => {
        Sortable.create(el, {
          ...opts,
          group: "bookmark-items",
          onEnd: (e) => {
            const [m] = bookmarks.value[e.from.dataset.colIndex].items.splice(e.oldIndex, 1);
            bookmarks.value[e.to.dataset.colIndex].items.splice(e.newIndex, 0, m);
            saveData("bookmark");
          },
        });
      });
    };

    // 对话框表单
    const openAddDialog = () => {
      isEditMode.value = false;
      addForm.value = { type: "service", name: "", href: "", description: "", abbr: "", group: "", column: "", icon: null, icon_file: null };
      if (fileInput.value) fileInput.value.value = "";
      if (serviceGroupNames.value.length > 0) addForm.value.group = serviceGroupNames.value[0];
      addDialogVisible.value = true;
    };
    const handleFileChange = (e) => {
      addForm.value.icon_file = e.target.files[0] || null;
    };
    const handleEdit = (colIndex, itemIndex, type) => {
      isEditMode.value = true;
      currentEditInfo.value = { type, colIndex, itemIndex };
      if (type === "bookmark") {
        const i = bookmarks.value[colIndex].items[itemIndex];
        addForm.value = { type: "bookmark", name: i._categoryName, abbr: i.abbr || "", href: i.href, icon: i.icon, column: bookmarks.value[colIndex].name };
      } else {
        const g = services.value[colIndex];
        const i = g.items[itemIndex];
        addForm.value = { type: "service", name: i.name, description: i.description, href: i.href, icon: i.icon, group: g.name };
      }
      addForm.value.icon_file = null;
      if (fileInput.value) fileInput.value.value = "";
      addDialogVisible.value = true;
    };
    const handleDelete = (colIndex, itemIndex, type) => {
      ElMessageBox.confirm("确定要删除此项目吗?", "警告", { type: "warning" })
        .then(() => {
          if (type === "bookmark") bookmarks.value[colIndex].items.splice(itemIndex, 1);
          else services.value[colIndex].items.splice(itemIndex, 1);
          saveData(type);
          ElMessage.success("项目已删除");
        })
        .catch(() => {});
    };
    const submitForm = async () => {
      const formData = new FormData();
      Object.keys(addForm.value).forEach((k) => {
        if (addForm.value[k] !== null && addForm.value[k] !== undefined) formData.append(k, addForm.value[k]);
      });
      try {
        const prepRes = await fetch("/api/item/prepare", { method: "POST", body: formData });
        const prepResult = await prepRes.json();
        if (!prepRes.ok) throw new Error(prepResult.error || "准备项目数据时出错");
        const item = prepResult.item;
        const type = isEditMode.value ? currentEditInfo.value.type : addForm.value.type;
        if (isEditMode.value) {
          const { colIndex, itemIndex } = currentEditInfo.value;
          if (type === "bookmark") {
            Object.assign(bookmarks.value[colIndex].items[itemIndex], { _categoryName: item.name, abbr: item.abbr, href: item.href, icon: item.icon });
          } else {
            Object.assign(services.value[colIndex].items[itemIndex], item);
          }
        } else {
          if (type === "bookmark") {
            const newItem = { _categoryName: item.name, abbr: item.abbr || item.name, href: item.href, icon: item.icon };
            let col = bookmarks.value.find((c) => c.name === addForm.value.column);
            if (col) col.items.push(newItem);
            else bookmarks.value.push({ name: addForm.value.column, items: [newItem] });
          } else {
            let group = services.value.find((g) => g.name === addForm.value.group);
            if (group) group.items.push(item);
            else services.value.push({ name: addForm.value.group, items: [item] });
          }
        }
        await saveData(type);
        addDialogVisible.value = false;
        await nextTick(initAllSortables);
      } catch (e) {
        ElMessage.error(`操作失败: ${e.message}`);
      }
    };

    // 导入
    const openDockerDialog = async () => {
      dockerDialogVisible.value = true;
      dockerSearchQuery.value = "";
      fetchDockerContainers();
    };
    const fetchDockerContainers = async () => {
      isDockerLoading.value = true;
      dockerContainers.value = [];
      try {
        const r = await fetch("/api/docker/containers");
        const result = await r.json();
        if (!r.ok) throw new Error(result.error || "获取容器列表失败");
        dockerContainers.value = result;
      } catch (e) {
        ElMessage.error(`加载 Docker 容器失败: ${e.message}`);
      } finally {
        isDockerLoading.value = false;
      }
    };
    const handleDockerImport = (container) => {
      dockerDialogVisible.value = false;
      const urls = container.suggested_urls || [];
      const url = urls.length > 0 ? urls[0] : "http://";
      let desc = `从 Docker 导入, 镜像: ${container.Image}`;
      if (urls.length > 1) {
        desc += `。其他可用地址: ${urls.slice(1).join(", ")}`;
      }
      isEditMode.value = false;
      addForm.value = { type: "service", name: container.Name, href: url, description: desc, abbr: "", group: "", icon: null, icon_file: null };
      if (fileInput.value) fileInput.value.value = "";
      if (serviceGroupNames.value.length > 0) addForm.value.group = serviceGroupNames.value[0];
      addDialogVisible.value = true;
      ElMessage.info(`已预填写'${container.Name}'的信息，请检查后保存。`);
    };
    const openLuckyDialog = async () => {
      luckyDialogVisible.value = true;
      luckySearchQuery.value = "";
      fetchLuckyProxies();
    };
    const fetchLuckyProxies = async () => {
      isLuckyLoading.value = true;
      luckyProxies.value = [];
      try {
        const r = await fetch("/api/lucky/proxies");
        const result = await r.json();
        if (!r.ok) throw new Error(result.error || "获取Lucky代理列表失败");
        luckyProxies.value = result;
      } catch (e) {
        ElMessage.error(`加载 Lucky 代理失败: ${e.message}`);
      } finally {
        isLuckyLoading.value = false;
      }
    };
    const handleLuckyImport = (proxy) => {
      luckyDialogVisible.value = false;
      isEditMode.value = false;
      addForm.value = {
        type: "service",
        name: proxy.Name,
        href: proxy.Url,
        description: `内网地址: ${proxy.LanUrl}`,
        abbr: "",
        group: "",
        icon: null,
        icon_file: null,
      };
      if (fileInput.value) fileInput.value.value = "";
      if (serviceGroupNames.value.length > 0) addForm.value.group = serviceGroupNames.value[0];
      addDialogVisible.value = true;
      ElMessage.info(`已预填写'${proxy.Name}'的信息，请检查后保存。`);
    };

    // 背景
    const openBackgroundDialog = async () => {
      await fetchSettings();
      try {
        const r = await fetch("/api/backgrounds");
        if (!r.ok) throw new Error("无法加载背景列表");
        backgroundList.value = await r.json();
      } catch (e) {
        ElMessage.error(e.message);
        backgroundList.value = [];
      }
      if (backgroundFileInput.value) backgroundFileInput.value.value = "";
      backgroundDialogVisible.value = true;
    };
    const selectBackgroundImage = (bg) => {
      backgroundForm.value.image = bg.url;
    };
    const handleBackgroundFileUpload = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      isUploadingBackground.value = true;
      const formData = new FormData();
      formData.append("file", file);
      try {
        const r = await fetch("/api/backgrounds/upload", { method: "POST", body: formData });
        const result = await r.json();
        if (!r.ok) throw new Error(result.error || "上传失败");
        backgroundForm.value.image = result.url;
        backgroundList.value.unshift({ url: result.url, name: file.name });
        ElMessage.success("上传成功！");
      } catch (e) {
        ElMessage.error(e.message);
      } finally {
        isUploadingBackground.value = false;
      }
    };
    const submitBackgroundSettings = async () => {
      isSavingBackground.value = true;
      try {
        const settings = {};
        for (const k in backgroundForm.value) {
          if (backgroundForm.value[k] !== "" && backgroundForm.value[k] !== null) settings[k] = backgroundForm.value[k];
        }
        const r = await fetch("/api/settings/background", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
        if (!r.ok) {
          const result = await r.json();
          throw new Error(result.error || "保存背景设置失败");
        }
        ElMessage.success("背景设置已保存！");
        backgroundDialogVisible.value = false;
      } catch (e) {
        ElMessage.error(`操作失败: ${e.message}`);
      } finally {
        isSavingBackground.value = false;
      }
    };

    watch(
      backgroundForm,
      (settings) => {
        const map = { sm: "4px", md: "8px", lg: "12px", xl: "16px", "2xl": "24px", "3xl": "32px" };
        document.body.style.backgroundImage = settings.image ? `url('${settings.image}')` : "none";
        const parts = [];
        if (settings.saturate !== 100) parts.push(`saturate(${settings.saturate}%)`);
        if (settings.blur && map[settings.blur]) parts.push(`blur(${map[settings.blur]})`);
        document.documentElement.style.setProperty("--bg-filter", parts.join(" "));
        document.documentElement.style.setProperty("--bg-opacity", `${(settings.opacity || 100) / 100}`);
      },
      { deep: true }
    );

    watch(
      () => addForm.value.name,
      (newName, oldName) => {
        if (!isEditMode.value && addForm.value.type === "service") {
          if (addForm.value.description === "" || addForm.value.description === oldName) {
            addForm.value.description = newName;
          }
        }
      }
    );

    onMounted(fetchAllData);

    return {
      services,
      bookmarks,
      config,
      isLoading,
      addDialogVisible,
      addForm,
      isEditMode,
      serviceGroupNames,
      bookmarkColumnNames,
      openAddDialog,
      handleFileChange,
      handleEdit,
      handleDelete,
      submitForm,
      fileInput,
      currentEditInfo,
      dockerDialogVisible,
      isDockerLoading,
      dockerSearchQuery,
      filteredDockerContainers,
      openDockerDialog,
      handleDockerImport,
      luckyDialogVisible,
      isLuckyLoading,
      luckyProxies,
      luckySearchQuery,
      filteredLuckyProxies,
      openLuckyDialog,
      handleLuckyImport,
      backgroundDialogVisible,
      isSavingBackground,
      isUploadingBackground,
      backgroundForm,
      backgroundFileInput,
      backgroundList,
      openBackgroundDialog,
      selectBackgroundImage,
      handleBackgroundFileUpload,
      submitBackgroundSettings,
      blurOptions,
      Edit,
      Delete,
      Plus,
      Link,
      Picture,
    };
  },
});

const style = document.createElement("style");
style.textContent = `
  body::before {
    content: ''; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background-image: inherit; background-size: cover; background-position: center; background-attachment: fixed;
    z-index: -1; filter: var(--bg-filter, none); opacity: var(--bg-opacity, 1);
    transition: opacity 0.5s ease-in-out, filter 0.5s ease-in-out;
  }
  body { background-image: none !important; }
`;
document.head.appendChild(style);

app.use(ElementPlus);
app.mount("#app");
