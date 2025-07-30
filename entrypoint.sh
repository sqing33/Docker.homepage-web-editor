#!/bin/sh

set -e

# --- 变量定义 ---
DATA_DIR="/app/data"
DEFAULT_CONFIG="/app/config.yaml.default"
CONFIG_FILE="${DATA_DIR}/config.yaml"

# --- 目录初始化 ---
echo "Ensuring persistent data directories exist..."
mkdir -p "${DATA_DIR}/icons"
mkdir -p "${DATA_DIR}/backgrounds"

# --- 配置检查与处理 ---
if [ ! -f "$CONFIG_FILE" ]; then
    echo "Configuration file not found. Initializing from default template and environment variables..."
    
    # 1. 复制默认配置
    cp "$DEFAULT_CONFIG" "$CONFIG_FILE"
    
    # 2. 使用 yq 和环境变量更新配置 (使用直接注入值的新方法)
    echo "Updating configuration from environment variables..."
    if [ -n "$ICON_STORAGE_STRATEGY" ]; then
      yq e ".icon_storage.strategy = \"$ICON_STORAGE_STRATEGY\"" -i "$CONFIG_FILE"
    fi
    if [ -n "$MINIO_ENDPOINT" ]; then
      yq e ".minio.endpoint = \"$MINIO_ENDPOINT\"" -i "$CONFIG_FILE"
    fi
    if [ -n "$MINIO_ACCESS_KEY" ]; then
      yq e ".minio.access_key = \"$MINIO_ACCESS_KEY\"" -i "$CONFIG_FILE"
    fi
    if [ -n "$MINIO_SECRET_KEY" ]; then
      yq e ".minio.secret_key = \"$MINIO_SECRET_KEY\"" -i "$CONFIG_FILE"
    fi
    if [ -n "$MINIO_ICONS_BUCKET_NAME" ]; then
      yq e ".minio.icons_bucket = \"$MINIO_ICONS_BUCKET_NAME\"" -i "$CONFIG_FILE"
    fi
    if [ -n "$MINIO_BACKGROUND_BUCKET_NAME" ]; then
      yq e ".minio.background_bucket = \"$MINIO_BACKGROUND_BUCKET_NAME\"" -i "$CONFIG_FILE"
    fi
    if [ -n "$MINIO_USE_SSL" ]; then
      # 对于布尔值，直接写入小写的 true/false 更规范
      val=$(echo "$MINIO_USE_SSL" | tr '[:upper:]' '[:lower:]')
      # 移除测试用的 '000'
      if [ "$val" = "true000" ]; then val="true"; fi
      yq e ".minio.use_ssl = $val" -i "$CONFIG_FILE"
    fi
    if [ -n "$DOCKER_API_ENDPOINT" ]; then
      yq e ".docker_api_endpoint = \"$DOCKER_API_ENDPOINT\"" -i "$CONFIG_FILE"
    fi
    
    echo "Initialization complete."
else
    echo "Existing configuration file found at ${CONFIG_FILE}. Skipping environment variable modifications."
fi

# --- 启动应用 ---
echo "Starting application..."
exec "$@" 
