const { createApp, ref, onMounted, nextTick, computed, watch } = Vue;
const { ElMessage, ElMessageBox } = ElementPlus;

const app = createApp({
  delimiters: ["[[", "]]"],
  setup() {
    // 定义响应式状态
    const services = ref([]); // 服务列表
    const bookmarks = ref([]); // 书签列表
    const config = ref({ groups: [], layout: {} }); // 配置信息
    const isLoading = ref(true); // 加载状态
    const addDialogVisible = ref(false); // 添加对话框显示状态
    const addForm = ref({}); // 添加表单数据
    const isEditMode = ref(false); // 是否为编辑模式
    const currentEditInfo = ref({}); // 当前编辑项信息
    const fileInput = ref(null); // 文件输入引用

    // Docker相关状态
    const dockerDialogVisible = ref(false); // Docker对话框显示状态
    const isDockerLoading = ref(false); // Docker加载状态
    const dockerContainers = ref([]); // Docker容器列表
    const dockerSearchQuery = ref(""); // Docker搜索关键词

    // 背景设置相关状态
    const backgroundDialogVisible = ref(false); // 背景对话框显示状态
    const isSavingBackground = ref(false); // 背景保存状态
    const isUploadingBackground = ref(false); // 背景上传状态
    const backgroundForm = ref({ image: "", saturate: 100, opacity: 100 }); // 背景表单数据
    const backgroundFileInput = ref(null); // 背景文件输入引用
    const backgroundList = ref([]); // 背景图片列表

    // 计算属性
    const serviceGroupNames = computed(() => services.value.map((g) => g.name)); // 服务组名列表
    const bookmarkColumnNames = computed(() => bookmarks.value.map((c) => c.name)); // 书签列名列表

    // 过滤后的Docker容器列表
    const filteredDockerContainers = computed(() => {
      // 根据搜索关键词过滤Docker容器
      if (!dockerSearchQuery.value) {
        return dockerContainers.value;
      }
      const query = dockerSearchQuery.value.toLowerCase();
      return dockerContainers.value.filter((container) => container.Name.toLowerCase().includes(query));
    });

    // 获取配置信息
    const fetchConfig = async () => {
      // 从API获取配置信息
      // 根据类型从API获取数据
      // 从API获取背景设置等信息
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
          backgroundForm.value = { ...{ image: "", saturate: 100, opacity: 100 }, ...settings.background };
        }
      } catch (error) {
        console.error("加载背景设置失败:", error);
      }
    };

    // 获取所有数据(配置、服务、书签、设置)
    const fetchAllData = async () => {
      // 并行获取所有数据
      isLoading.value = true;
      await Promise.all([fetchConfig(), fetchItems("service"), fetchItems("bookmark"), fetchSettings()]);
      isLoading.value = false;
      nextTick(initAllSortables); // 数据加载完成后初始化拖拽排序
    };

    // 保存数据(服务或书签)
    const saveData = async (type) => {
      // 根据类型准备要保存的数据
      let dataToSave;
      if (type === "service") {
        dataToSave = services.value.map((group) => ({
          [group.name]: group.items.map((item) => {
            const { name, ...details } = item;
            return { [name]: details };
          }),
        }));
      } else {
        // 服务编辑数据准备
        // 书签数据准备
        dataToSave = bookmarks.value.map((column) => {
          const reconstructedCategories = column.items.map((item) => {
            const { _categoryName, href, abbr, icon } = item;
            const bookmarkDetails = { href };
            if (abbr) bookmarkDetails.abbr = abbr;
            if (icon) bookmarkDetails.icon = icon;
            return { [_categoryName]: [bookmarkDetails] };
          });
          return { [column.name]: reconstructedCategories };
        });
      }
      // 调用API保存数据
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
      // 拖拽排序公共配置
      const commonSortableOptions = { animation: 150, ghostClass: "ghost" };
      const servicesSection = document.querySelector(".services-section");
      if (servicesSection) {
        // 初始化服务区域拖拽排序
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
      // 初始化服务容器拖拽排序
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
      // 初始化书签列拖拽排序
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
      // 初始化书签项拖拽排序
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
      // 初始化表单并显示对话框
      isEditMode.value = false;
      addForm.value = { type: "service", name: "", href: "", description: "", abbr: "", group: "", column: "", icon: null, icon_file: null };
      if (fileInput.value) fileInput.value.value = "";
      addDialogVisible.value = true;
    };

    // 处理文件选择变化
    const handleFileChange = (event) => {
      // 更新表单中的文件引用
      addForm.value.icon_file = event.target.files[0] || null;
    };

    // 处理编辑项目
    const handleEdit = (colIndex, itemIndex, type) => {
      // 设置编辑模式并填充表单数据
      isEditMode.value = true;
      currentEditInfo.value = { type, colIndex, itemIndex };
      if (type === "bookmark") {
        // 书签编辑数据准备
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
      // 显示确认对话框并处理删除逻辑
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
      // 准备表单数据并提交
      const formData = new FormData();
      Object.keys(addForm.value).forEach((key) => {
        if (addForm.value[key] !== null && addForm.value[key] !== undefined) formData.append(key, addForm.value[key]);
      });
      // 调用API处理表单提交
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
      // 显示对话框并获取Docker容器列表
      dockerDialogVisible.value = true;
      dockerSearchQuery.value = ""; // 打开时清空搜索词
      fetchDockerContainers();
    };

    // 获取Docker容器列表
    const fetchDockerContainers = async () => {
      // 从API获取Docker容器数据
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
        // 无论成功失败都更新加载状态
        isDockerLoading.value = false;
      }
    };

    // 处理从Docker导入容器
    const handleDockerImport = (container) => {
      // 关闭对话框并预填充表单
      dockerDialogVisible.value = false;

      const suggested_urls = container.suggested_urls || [];
      const default_url = suggested_urls.length > 0 ? suggested_urls[0] : "http://";

      let description = `从 Docker 导入, 镜像: ${container.Image}`;
      if (suggested_urls.length > 1) {
        // 如果有多个建议URL，添加到描述中
        description += `。其他可用地址: ${suggested_urls.slice(1).join(", ")}`;
      }

      isEditMode.value = false;
      // 预填充表单数据
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
      // 获取当前设置并显示对话框
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
      // 重置文件输入
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
        const response = await fetch("/api/settings/background", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(backgroundForm.value) });
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

    // 监听背景表单变化并更新CSS变量
    watch(
      backgroundForm,
      (newSettings) => {
        const { image, saturate, opacity } = newSettings;
        document.body.style.backgroundImage = image ? `url('${image}')` : "none";
        document.documentElement.style.setProperty("--bg-saturate", `${saturate || 100}%`);
        document.documentElement.style.setProperty("--bg-opacity", `${(opacity || 100) / 100}`);
      },
      { deep: true }
    );

    // 组件挂载后获取所有数据
    onMounted(fetchAllData);

    // 返回模板中使用的所有状态和方法
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
    };
  },
});

const style = document.createElement("style");
style.textContent = `
  body::before {
    content: ''; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background-image: inherit; background-size: cover; background-position: center; background-attachment: fixed;
    z-index: -1;
    filter: saturate(var(--bg-saturate, 100%));
    opacity: var(--bg-opacity, 1);
    transition: opacity 0.5s ease-in-out, filter 0.5s ease-in-out;
  }
  body { background-image: none !important; }
`;
document.head.appendChild(style);

app.use(ElementPlus);
app.mount("#app");
