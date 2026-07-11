<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  Dialog,
  Toast,
  VAlert,
  VButton,
  VCard,
  VDescription,
  VDescriptionItem,
  VEmpty,
  VLoading,
  VPageHeader,
  VSpace,
  VStatusDot,
  VSwitch,
  VTag,
} from "@halo-dev/components";
import {
  axiosInstance,
  consoleApiClient,
  coreApiClient,
  type Policy,
} from "@halo-dev/api-client";
import { isAxiosError, type AxiosError } from "axios";

type SyncResult = {
  added: number;
  skipped: number;
  deleted?: number;
  cleanupDeleted?: boolean;
  message?: string;
};

type PolicyConfig = {
  createDateFolders?: boolean | string;
  cleanupDeleted?: boolean | string;
  [key: string]: unknown;
};

const policies = ref<Policy[]>([]);
const selectedPolicyName = ref("");
const loadingPolicies = ref(false);
const syncing = ref(false);
const syncResult = ref<SyncResult>();
const clientError = ref("");
const policyConfig = ref<PolicyConfig>({});
const loadingPolicyConfig = ref(false);
const savingCreateDateFolders = ref(false);
const savingCleanupDeleted = ref(false);

const selectedPolicy = computed(() =>
  policies.value.find((policy) => policy.metadata.name === selectedPolicyName.value),
);

const createDateFolders = computed(() =>
  isEnabled(policyConfig.value.createDateFolders),
);

const cleanupDeleted = computed(() =>
  isEnabled(policyConfig.value.cleanupDeleted),
);

function isEnabled(value: unknown) {
  return value === true || value === "true";
}

function getSyncResultMessage(result: SyncResult) {
  return (
    result.message ||
    `同步完成：新增 ${result.added} 个文件，跳过 ${result.skipped} 个已存在文件，清理 ${
      result.deleted || 0
    } 个失效附件。`
  );
}

function getAxiosMessage(error: AxiosError<{ message?: string }>) {
  return error.response?.data?.message || error.message || "请求失败";
}

async function loadPolicies() {
  loadingPolicies.value = true;
  clientError.value = "";

  try {
    const { data } = await coreApiClient.storage.policy.listPolicy({
      page: 1,
      size: 100,
      sort: ["metadata.creationTimestamp,desc"],
    });

    policies.value = data.items.filter(
      (policy) => policy.spec.templateName === "openlist",
    );

    if (!selectedPolicyName.value && policies.value.length > 0) {
      selectedPolicyName.value = policies.value[0].metadata.name;
    }

    if (selectedPolicyName.value) {
      await loadPolicyConfig(selectedPolicyName.value);
    }
  } catch (error) {
    if (!isAxiosError(error)) {
      clientError.value =
        error instanceof Error ? error.message : "加载 OpenList 存储策略失败";
    }
  } finally {
    loadingPolicies.value = false;
  }
}

async function loadPolicyConfig(policyName: string) {
  if (!policyName) {
    policyConfig.value = {};
    return;
  }

  loadingPolicyConfig.value = true;

  try {
    const { data } = await consoleApiClient.storage.policy.getPolicyConfigByGroup({
      name: policyName,
      group: "default",
    });

    policyConfig.value = data as PolicyConfig;
  } catch (error) {
    if (!isAxiosError(error)) {
      clientError.value =
        error instanceof Error ? error.message : "加载 OpenList 策略配置失败";
    }
    policyConfig.value = {};
  } finally {
    loadingPolicyConfig.value = false;
  }
}

async function savePolicyConfig(
  nextConfig: PolicyConfig,
  successMessage: string,
) {
  if (!selectedPolicyName.value) {
    return false;
  }

  clientError.value = "";

  try {
    await consoleApiClient.storage.policy.updatePolicyConfigByGroup({
      name: selectedPolicyName.value,
      group: "default",
      body: nextConfig,
    });

    policyConfig.value = nextConfig;
    Toast.success(successMessage);
    return true;
  } catch (error) {
    if (!isAxiosError(error)) {
      clientError.value =
        error instanceof Error ? error.message : "保存 OpenList 策略配置失败";
    }
    return false;
  }
}

async function updateCreateDateFolders(value: boolean) {
  if (savingCreateDateFolders.value) {
    return;
  }

  savingCreateDateFolders.value = true;

  await savePolicyConfig(
    {
      ...policyConfig.value,
      createDateFolders: value,
    },
    value ? "已开启按年月自动分目录" : "已关闭按年月自动分目录",
  );

  savingCreateDateFolders.value = false;
}

async function updateCleanupDeleted(value: boolean) {
  if (savingCleanupDeleted.value) {
    return;
  }

  savingCleanupDeleted.value = true;

  await savePolicyConfig(
    {
      ...policyConfig.value,
      cleanupDeleted: value,
    },
    value ? "已开启同步清理失效附件" : "已关闭同步清理失效附件",
  );

  savingCleanupDeleted.value = false;
}

function syncOpenList() {
  if (!selectedPolicyName.value || syncing.value) {
    return;
  }

  Dialog.warning({
    title: "同步 OpenList 文件",
    description: cleanupDeleted.value
      ? "将扫描 OpenList 目录，导入新增文件，并删除 Halo 附件库中远端已不存在的附件记录。"
      : "将扫描 OpenList 目录，并把未登记的文件写入 Halo 附件库。",
    showCancel: true,
    confirmText: "开始同步",
    cancelText: "取消",
    onConfirm: doSyncOpenList,
  });
}

async function doSyncOpenList() {
  if (!selectedPolicyName.value || syncing.value) {
    return;
  }

  syncing.value = true;
  syncResult.value = undefined;
  clientError.value = "";

  try {
    const { data } = await axiosInstance.post<SyncResult>(
      "/apis/api.console.halo.run/v1alpha1/openlist/sync",
      undefined,
      {
        params: {
          policyName: selectedPolicyName.value,
          cleanupDeleted: cleanupDeleted.value,
        },
      },
    );

    syncResult.value = data;
    const message = getSyncResultMessage(data);
    Toast.success(message);
    Dialog.success({
      title: "OpenList 文件同步完成",
      description: message,
      confirmText: "知道了",
    });
  } catch (error) {
    clientError.value = isAxiosError<{ message?: string }>(error)
      ? getAxiosMessage(error)
      : error instanceof Error
        ? error.message
        : "同步 OpenList 文件失败";
  } finally {
    syncing.value = false;
  }
}

onMounted(loadPolicies);

watch(selectedPolicyName, (policyName) => {
  syncResult.value = undefined;
  if (policyName) {
    loadPolicyConfig(policyName);
  } else {
    policyConfig.value = {};
  }
});
</script>

<template>
  <div class="openlist-sync">
    <VPageHeader title="OpenList 同步">
      <template #actions>
        <VSpace>
          <VButton :loading="loadingPolicies" type="secondary" @click="loadPolicies">
            刷新
          </VButton>
          <VButton
            :disabled="!selectedPolicyName || loadingPolicies"
            :loading="syncing"
            type="primary"
            @click="syncOpenList"
          >
            开始同步
          </VButton>
        </VSpace>
      </template>
    </VPageHeader>

    <VLoading v-if="loadingPolicies && !policies.length" />

    <div v-else class="openlist-sync__body">
      <VAlert
        v-if="clientError"
        :description="clientError"
        title="操作失败"
        type="error"
      />

      <VEmpty
        v-if="!policies.length"
        message="暂无 OpenList 存储策略"
        title="未找到可同步的策略"
      >
        <template #actions>
          <VButton :loading="loadingPolicies" type="secondary" @click="loadPolicies">
            重新加载
          </VButton>
        </template>
      </VEmpty>

      <template v-else>
        <VCard title="存储策略">
          <div class="policy-list">
            <button
              v-for="policy in policies"
              :key="policy.metadata.name"
              :class="[
                'policy-item',
                {
                  'policy-item--active':
                    policy.metadata.name === selectedPolicyName,
                },
              ]"
              type="button"
              @click="selectedPolicyName = policy.metadata.name"
            >
              <span class="policy-item__main">
                <span class="policy-item__name">
                  {{ policy.spec.displayName || policy.metadata.name }}
                </span>
                <span class="policy-item__meta">
                  {{ policy.metadata.name }}
                </span>
              </span>
              <VTag v-if="policy.metadata.name === selectedPolicyName" theme="primary">
                已选择
              </VTag>
            </button>
          </div>
        </VCard>

        <VCard title="同步状态">
          <VDescription>
            <VDescriptionItem label="当前策略">
              {{ selectedPolicy?.spec.displayName || selectedPolicy?.metadata.name }}
            </VDescriptionItem>
            <VDescriptionItem label="策略模板">
              <VTag>openlist</VTag>
            </VDescriptionItem>
            <VDescriptionItem label="配置状态">
              <span class="status-line">
                <VStatusDot :state="selectedPolicy?.spec.configMapName ? 'success' : 'warning'" />
                {{
                  selectedPolicy?.spec.configMapName
                    ? "已关联 ConfigMap"
                    : "未关联 ConfigMap"
                }}
              </span>
            </VDescriptionItem>
            <VDescriptionItem label="按年月分目录">
              <span class="switch-line">
                <VSwitch
                  :disabled="!selectedPolicyName || loadingPolicyConfig"
                  :loading="savingCreateDateFolders"
                  :model-value="createDateFolders"
                  @update:model-value="updateCreateDateFolders"
                />
                <span>
                  {{
                    createDateFolders
                      ? "开启，文件会进入上传根路径/yyyy/MM"
                      : "关闭，文件会直接进入上传根路径"
                  }}
                </span>
              </span>
            </VDescriptionItem>
            <VDescriptionItem label="清理失效附件">
              <span class="switch-line">
                <VSwitch
                  :disabled="!selectedPolicyName || loadingPolicyConfig"
                  :loading="savingCleanupDeleted"
                  :model-value="cleanupDeleted"
                  @update:model-value="updateCleanupDeleted"
                />
                <span>
                  {{
                    cleanupDeleted
                      ? "开启，同步时会删除远端已不存在的 Halo 附件记录"
                      : "关闭，同步只新增和跳过，不删除 Halo 附件记录"
                  }}
                </span>
              </span>
            </VDescriptionItem>
          </VDescription>

          <VAlert
            v-if="syncResult"
            class="sync-result"
            :description="getSyncResultMessage(syncResult)"
            title="同步完成"
            type="success"
          />
        </VCard>
      </template>
    </div>
  </div>
</template>

<style scoped>
.openlist-sync {
  min-height: 100%;
}

.openlist-sync__body {
  display: grid;
  gap: 16px;
  padding: 16px;
}

.policy-list {
  display: grid;
  gap: 8px;
}

.policy-item {
  display: flex;
  min-height: 64px;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border: 1px solid var(--halo-gray-200, #e5e7eb);
  border-radius: 8px;
  background: var(--halo-color-background, #fff);
  padding: 12px 16px;
  text-align: left;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.policy-item:hover {
  border-color: var(--halo-primary, #4f46e5);
}

.policy-item--active {
  border-color: var(--halo-primary, #4f46e5);
  box-shadow: 0 0 0 1px var(--halo-primary, #4f46e5);
}

.policy-item__main {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.policy-item__name,
.policy-item__meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.policy-item__name {
  color: var(--halo-gray-900, #111827);
  font-size: 14px;
  font-weight: 600;
}

.policy-item__meta {
  color: var(--halo-gray-500, #6b7280);
  font-size: 13px;
}

.status-line,
.switch-line {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.sync-result {
  margin-top: 16px;
}
</style>
