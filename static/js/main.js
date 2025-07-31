const { createApp, ref, onMounted, nextTick, computed, watch } = Vue;
const { ElMessage, ElMessageBox } = ElementPlus;

const app = createApp({
  delimiters: ["[[", "]]"],
  setup() {
    // 定义响应式状态
    const services = ref([]);
    const bookmarks = ref([]);
    const config = ref({ groups: [], layout: {} });
    const isLoading = ref(true);
    const addDialogVisible = ref(false);
    const addForm = ref({});
    const isEditMode = ref(false);
    const currentEditInfo = ref({});
    const fileInput = ref(null);

    // Docker相关状态
    const dockerDialogVisible = ref(false);
    const isDockerLoading = ref(false);
    const dockerContainers = ref([]);
    const dockerSearchQuery = ref("");

    // --- MODIFICATION START: Updated background states ---
    const backgroundDialogVisible = ref(false);
    const isSavingBackground = ref(false);
    const isUploadingBackground = ref(false);
    // Add new fields: blur, brightness, cardBlur with default values
    const backgroundForm = ref({ image: "", saturate: 100, opacity: 100, blur: "", brightness: 100, cardBlur: "" });
    const backgroundFileInput = ref(null);
    const backgroundList = ref([]);

    // Options for blur selects
    const blurOptions = ref([
      { value: "sm", label: "小 (sm)" },
      { value: "md", label: "中 (md)" },
      { value: "lg", label: "大 (lg)" },
      { value: "xl", label: "特大 (xl)" },
      { value: "2xl", label: "超大 (2xl)" },
      { value: "3xl", label: "极大 (3xl)" },
    ]);

    // Computed properties to handle incompatibility
    const isCardBlurActive = computed(() => !!backgroundForm.value.cardBlur);
    const isBackgroundFilterActive = computed(() => !!backgroundForm.value.blur || backgroundForm.value.saturate !== 100 || backgroundForm.value.brightness !== 100);
    // --- MODIFICATION END ---

    // 计算属性
    const serviceGroupNames = computed(() => services.value.map((g) => g.name));
    const bookmarkColumnNames = computed(() => bookmarks.value.map((c) => c.name));

    const filteredDockerContainers = computed(() => {
      if (!dockerSearchQuery.value) return dockerContainers.value;
      const query = dockerSearchQuery.value.toLowerCase();
      return dockerContainers.value.filter((container) => container.Name.toLowerCase().includes(query));
    });

    // 获取配置信息
    const fetchConfig = async () => {
      try {
        const response = await fetch("/api/config");
        config.value = await response.json();
      } catch (error) {
        ElMessage.error("加载配置失败");
      }
    };

    // 获取项目数据(服务或书签)
    const fetchItems = async (type) => {
      try {
        const response = await fetch(`/api/${type}s`);
        const data = await response.json();
        if (data.error) throw new Error(data.error);

        if (type === "service") {
          services.value = (data || []).map((group) => ({
            name: Object.keys(group)[0],
            items: (Object.values(group)[0] || []).map((item) => ({ name: Object.keys(item)[0], ...Object.values(item)[0] })),
          }));
        } else {
          bookmarks.value = (data || []).map((column) => {
            const columnName = Object.keys(column)[0];
            const categories = Object.values(column)[0] || [];
            const allItems = [];
            categories.forEach((categoryObj) => {
              const categoryName = Object.keys(categoryObj)[0];
              const items = Object.values(categoryObj)[0] || [];
              items.forEach((item) => {
                allItems.push({ ...item, _categoryName: categoryName });
              });
            });
            return { name: columnName, items: allItems };
          });
        }
      } catch (error) {
        ElMessage.error(`加载 ${type} 失败: ${error.message}`);
      }
    };

    // 获取设置信息
    const fetchSettings = async () => {
      try {
        const response = await fetch("/api/settings");
        if (!response.ok) throw new Error("无法加载设置");
        const settings = await response.json();
        if (settings.background) {
          // --- MODIFICATION START: Merge with new default fields ---
          const defaultBgSettings = { image: "", saturate: 100, opacity: 100, blur: "", brightness: 100, cardBlur: "" };
          backgroundForm.value = { ...defaultBgSettings, ...settings.background };
          // --- MODIFICATION END ---
        }
      } catch (error) {
        console.error("加载背景设置失败:", error);
      }
    };

    // 获取所有数据(配置、服务、书签、设置)
    const fetchAllData = async () => {
      isLoading.value = true;
      await Promise.all([fetchConfig(), fetchItems("service"), fetchItems("bookmark"), fetchSettings()]);
      isLoading.value = false;
      nextTick(initAllSortables);
    };

    // 保存数据(服务或书签)
    const saveData = async (type) => {
      let dataToSave;
      if (type === "service") {
        dataToSave = services.value.map((group) => ({
          [group.name]: group.items.map((item) => {
            const { name, ...details } = item;
            return { [name]: details };
          }),
        }));
      } else {
        dataToSave = bookmarks.value.map((column) => {
          // This logic seems to have a bug, it will group bookmarks incorrectly.
          // Let's fix it while we are here.
          const categories = {};
          column.items.forEach((item) => {
            if (!categories[item._categoryName]) {
              categories[item._categoryName] = [];
            }
            const { href, abbr, icon } = item;
            const bookmarkDetails = { href };
            if (abbr) bookmarkDetails.abbr = abbr;
            if (icon) bookmarkDetails.icon = icon;
            categories[item._categoryName].push(bookmarkDetails);
          });

          const reconstructedCategories = Object.keys(categories).map((catName) => {
            return { [catName]: categories[catName] };
          });

          return { [column.name]: reconstructedCategories };
        });
      }
      try {
        const response = await fetch(`/api/${type}s`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(dataToSave, null, 2),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "未知错误");
        ElMessage.success(`${type} 配置已成功保存！`);
      } catch (error) {
        ElMessage.error(`保存失败: ${error.message}`);
      }
    };

    // 初始化所有拖拽排序功能
    const initAllSortables = () => {
      const commonSortableOptions = { animation: 150, ghostClass: "ghost" };
      const servicesSection = document.querySelector(".services-section");
      if (servicesSection) {
        Sortable.create(servicesSection, {
          ...commonSortableOptions,
          handle: ".group-title",
          onEnd: (evt) => {
            const [movedGroup] = services.value.splice(evt.oldIndex, 1);
            services.value.splice(evt.newIndex, 0, movedGroup);
            saveData("service");
          },
        });
      }
      document.querySelectorAll('.sortable-container[data-type="service"]').forEach((el) => {
        Sortable.create(el, {
          ...commonSortableOptions,
          group: "service-items",
          onEnd: (evt) => {
            const fromGroupIndex = evt.from.dataset.groupIndex;
            const toGroupIndex = evt.to.dataset.groupIndex;
            const [movedItem] = services.value[fromGroupIndex].items.splice(evt.oldIndex, 1);
            services.value[toGroupIndex].items.splice(evt.newIndex, 0, movedItem);
            saveData("service");
          },
        });
      });
      const bookmarkColumnContainer = document.querySelector('.sortable-container[data-type="bookmark-column"]');
      if (bookmarkColumnContainer) {
        Sortable.create(bookmarkColumnContainer, {
          ...commonSortableOptions,
          handle: ".bookmarks-column-title",
          onEnd: (evt) => {
            const [moved] = bookmarks.value.splice(evt.oldIndex, 1);
            bookmarks.value.splice(evt.newIndex, 0, moved);
            saveData("bookmark");
          },
        });
      }
      document.querySelectorAll('.sortable-container[data-type="bookmark-item"]').forEach((el) => {
        Sortable.create(el, {
          ...commonSortableOptions,
          group: "bookmark-items",
          onEnd: (evt) => {
            const fromColIdx = evt.from.dataset.colIndex;
            const toColIdx = evt.to.dataset.colIndex;
            const [movedItem] = bookmarks.value[fromColIdx].items.splice(evt.oldIndex, 1);
            bookmarks.value[toColIdx].items.splice(evt.newIndex, 0, movedItem);
            saveData("bookmark");
          },
        });
      });
    };

    // 打开添加项目对话框
    const openAddDialog = () => {
      isEditMode.value = false;
      addForm.value = { type: "service", name: "", href: "", description: "", abbr: "", group: "", column: "", icon: null, icon_file: null };
      if (fileInput.value) fileInput.value.value = "";
      if (serviceGroupNames.value.length > 0) {
        addForm.value.group = serviceGroupNames.value[0];
      }
      addDialogVisible.value = true;
    };

    // 处理文件选择变化
    const handleFileChange = (event) => {
      addForm.value.icon_file = event.target.files[0] || null;
    };

    // 处理编辑项目
    const handleEdit = (colIndex, itemIndex, type) => {
      isEditMode.value = true;
      currentEditInfo.value = { type, colIndex, itemIndex };
      if (type === "bookmark") {
        const item = bookmarks.value[colIndex].items[itemIndex];
        addForm.value = { type: "bookmark", name: item._categoryName, abbr: item.abbr || "", href: item.href, icon: item.icon, column: bookmarks.value[colIndex].name };
      } else {
        const group = services.value[colIndex];
        const item = group.items[itemIndex];
        addForm.value = { type: "service", name: item.name, description: item.description, href: item.href, icon: item.icon, group: group.name };
      }
      addForm.value.icon_file = null;
      if (fileInput.value) fileInput.value.value = "";
      addDialogVisible.value = true;
    };

    // 处理删除项目
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

    // 提交表单(添加/编辑项目)
    const submitForm = async () => {
      const formData = new FormData();
      Object.keys(addForm.value).forEach((key) => {
        if (addForm.value[key] !== null && addForm.value[key] !== undefined) formData.append(key, addForm.value[key]);
      });
      try {
        const prepareResponse = await fetch("/api/item/prepare", { method: "POST", body: formData });
        const prepareResult = await prepareResponse.json();
        if (!prepareResponse.ok) throw new Error(prepareResult.error || "准备项目数据时出错");

        const processedItem = prepareResult.item;
        const itemType = isEditMode.value ? currentEditInfo.value.type : addForm.value.type;
        if (isEditMode.value) {
          const { colIndex, itemIndex } = currentEditInfo.value;
          if (itemType === "bookmark") {
            const itemToUpdate = bookmarks.value[colIndex].items[itemIndex];
            itemToUpdate._categoryName = processedItem.name;
            itemToUpdate.abbr = processedItem.abbr;
            itemToUpdate.href = processedItem.href;
            itemToUpdate.icon = processedItem.icon;
          } else {
            const itemToUpdate = services.value[colIndex].items[itemIndex];
            itemToUpdate.name = processedItem.name;
            itemToUpdate.description = processedItem.description;
            itemToUpdate.href = processedItem.href;
            itemToUpdate.icon = processedItem.icon;
          }
        } else {
          if (itemType === "bookmark") {
            const newBookmark = { _categoryName: processedItem.name, abbr: processedItem.abbr || processedItem.name, href: processedItem.href, icon: processedItem.icon };
            let col = bookmarks.value.find((c) => c.name === addForm.value.column);
            if (col) col.items.push(newBookmark);
            else bookmarks.value.push({ name: addForm.value.column, items: [newBookmark] });
          } else {
            const newService = { name: processedItem.name, description: processedItem.description, href: processedItem.href, icon: processedItem.icon };
            let group = services.value.find((g) => g.name === addForm.value.group);
            if (group) group.items.push(newService);
            else services.value.push({ name: addForm.value.group, items: [newService] });
          }
        }
        await saveData(itemType);
        addDialogVisible.value = false;
        await nextTick(initAllSortables);
      } catch (error) {
        ElMessage.error(`操作失败: ${error.message}`);
      }
    };

    // 打开Docker导入对话框
    const openDockerDialog = async () => {
      dockerDialogVisible.value = true;
      dockerSearchQuery.value = "";
      fetchDockerContainers();
    };

    // 获取Docker容器列表
    const fetchDockerContainers = async () => {
      isDockerLoading.value = true;
      dockerContainers.value = [];
      try {
        const response = await fetch("/api/docker/containers");
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || "获取容器列表失败");
        }
        dockerContainers.value = result;
      } catch (error) {
        ElMessage.error(`加载 Docker 容器失败: ${error.message}`);
      } finally {
        isDockerLoading.value = false;
      }
    };

    // 处理从Docker导入容器
    const handleDockerImport = (container) => {
      dockerDialogVisible.value = false;
      const suggested_urls = container.suggested_urls || [];
      const default_url = suggested_urls.length > 0 ? suggested_urls[0] : "http://";

      let description = `从 Docker 导入, 镜像: ${container.Image}`;
      if (suggested_urls.length > 1) {
        description += `。其他可用地址: ${suggested_urls.slice(1).join(", ")}`;
      }

      isEditMode.value = false;
      addForm.value = {
        type: "service",
        name: container.Name,
        href: default_url,
        description: description,
        abbr: "",
        group: "",
        column: "",
        icon: null,
        icon_file: null,
      };
      if (fileInput.value) fileInput.value.value = "";
      addDialogVisible.value = true;

      ElMessage.info(`已预填写'${container.Name}'的信息，请检查访问地址和分组后保存。`);
    };

    // 打开背景设置对话框
    const openBackgroundDialog = async () => {
      await fetchSettings();
      try {
        const response = await fetch("/api/backgrounds");
        if (!response.ok) throw new Error("无法加载背景列表");
        backgroundList.value = await response.json();
      } catch (error) {
        ElMessage.error(error.message);
        backgroundList.value = [];
      }
      if (backgroundFileInput.value) backgroundFileInput.value.value = "";
      backgroundDialogVisible.value = true;
    };

    // 选择背景图片
    const selectBackgroundImage = (bg) => {
      backgroundForm.value.image = bg.url;
    };

    // 处理背景文件上传
    const handleBackgroundFileUpload = async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      isUploadingBackground.value = true;
      const formData = new FormData();
      formData.append("file", file);
      try {
        const response = await fetch("/api/backgrounds/upload", { method: "POST", body: formData });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "上传失败");
        backgroundForm.value.image = result.url;
        backgroundList.value.unshift({ url: result.url, name: file.name });
        ElMessage.success("上传成功！");
      } catch (error) {
        ElMessage.error(error.message);
      } finally {
        isUploadingBackground.value = false;
      }
    };

    // 提交背景设置
    const submitBackgroundSettings = async () => {
      isSavingBackground.value = true;
      try {
        // Create a clean object to save, removing any empty properties
        const settingsToSave = {};
        for (const key in backgroundForm.value) {
          if (backgroundForm.value[key] !== "" && backgroundForm.value[key] !== null) {
            settingsToSave[key] = backgroundForm.value[key];
          }
        }

        const response = await fetch("/api/settings/background", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settingsToSave) });
        if (!response.ok) {
          const result = await response.json();
          throw new Error(result.error || "保存背景设置失败");
        }
        ElMessage.success("背景设置已保存！");
        backgroundDialogVisible.value = false;
      } catch (error) {
        ElMessage.error(`操作失败: ${error.message}`);
      } finally {
        isSavingBackground.value = false;
      }
    };

    // --- MODIFICATION START: Expanded watcher for background filters ---
    const blurMap = { sm: "4px", md: "8px", lg: "12px", xl: "16px", "2xl": "24px", "3xl": "32px" };

    watch(
      backgroundForm,
      (newSettings) => {
        const { image, saturate, opacity, blur, brightness } = newSettings;
        document.body.style.backgroundImage = image ? `url('${image}')` : "none";

        const filterParts = [];
        if (saturate !== 100) filterParts.push(`saturate(${saturate}%)`);
        if (brightness !== 100) filterParts.push(`brightness(${brightness}%)`);
        if (blur && blurMap[blur]) filterParts.push(`blur(${blurMap[blur]})`);

        document.documentElement.style.setProperty("--bg-filter", filterParts.join(" "));
        document.documentElement.style.setProperty("--bg-opacity", `${(opacity || 100) / 100}`);
      },
      { deep: true }
    );
    // --- MODIFICATION END ---

    // 监听 'addForm' 中 'name' 的变化，用于同步 'description'
    watch(
      () => addForm.value.name,
      (newName) => {
        if (!isEditMode.value && addForm.value.type === "service") {
          addForm.value.description = newName;
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
      Edit,
      Delete,
      Plus,
      Link,
      Picture,
      QuestionFilled, // Make icon available to template
      // --- MODIFICATION START: Expose new states and options ---
      blurOptions,
      isCardBlurActive,
      isBackgroundFilterActive,
      // --- MODIFICATION END ---
    };
  },
});

// --- MODIFICATION START: Updated CSS for new filters ---
const style = document.createElement("style");
style.textContent = `
  body::before {
    content: ''; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background-image: inherit; background-size: cover; background-position: center; background-attachment: fixed;
    z-index: -1;
    filter: var(--bg-filter, none);
    opacity: var(--bg-opacity, 1);
    transition: opacity 0.5s ease-in-out, filter 0.5s ease-in-out;
  }
  body { background-image: none !important; }
`;
document.head.appendChild(style);
// --- MODIFICATION END ---

app.use(ElementPlus);
app.mount("#app");
