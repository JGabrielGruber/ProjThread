import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  fileReport,
  rootTitle,
  type CaptureHarvest,
} from "../../lib/capture.ts";
import {
  SHARE_CACHE,
  harvestFromShare,
  parseShareId,
  readSharePark,
  suggestedSentence,
  type ShareFields,
  type ShareFile,
} from "../../lib/share-target.ts";
import { ApiError } from "../services/http.ts";
import { createProject as createProjectRequest, listProjects } from "../services/catalog.ts";
import { pwaCaptureApi } from "../services/capture.ts";

export type CaptureUiStatus = "ready" | "filing" | "error";

export const useCaptureStore = defineStore("capture", () => {
  const status = ref<CaptureUiStatus>("ready");
  const message = ref("");
  const projects = ref<{ id: string; parent_id: string | null; name: string }[]>([]);
  const selectedId = ref<string | null>(null);
  const harvest = ref<CaptureHarvest | null>(null);
  const sentence = ref("");
  const nodeType = ref<"note" | "research">("note");
  const refId = ref("");
  const files = ref<ShareFile[]>([]);
  const filing = ref(false);

  const rootId = computed(
    () => projects.value.find((p) => p.parent_id == null)?.id ?? null,
  );
  const attachProjectId = computed(() => selectedId.value ?? rootId.value);

  function applyFields(fields: ShareFields): void {
    harvest.value = harvestFromShare(fields);
    sentence.value = suggestedSentence(fields);
  }

  async function consumeShare(rawId: string): Promise<void> {
    const id = parseShareId(rawId);
    if (!id) return;
    const cache = await caches.open(SHARE_CACHE);
    const park = await readSharePark(cache, id);
    if (!park) return;
    applyFields(park);
    files.value = park.files;
  }

  async function loadProjects(workspaceId: string): Promise<void> {
    const body = await listProjects(workspaceId);
    projects.value = body.projects;
  }

  async function createProject(
    workspaceId: string,
    name: string,
    parentId: string,
  ): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    const body = await createProjectRequest(workspaceId, {
      name: trimmed,
      parent_id: parentId,
    });
    await loadProjects(workspaceId);
    selectedId.value = body.project.id;
  }

  async function file(workspaceId: string, projectId: string): Promise<void> {
    const current = harvest.value ?? harvestFromShare({ title: "", text: sentence.value, url: "" });
    if (filing.value) return;
    filing.value = true;
    status.value = "filing";
    message.value = "";
    try {
      await fileReport(pwaCaptureApi(), {
        workspaceId,
        projectId,
        sentence: sentence.value,
        type: nodeType.value,
        harvest: current,
        refId: refId.value.trim() || null,
        files: files.value,
      });
      status.value = "ready";
      message.value = `Filed ${rootTitle(current.page_title)}`;
    } catch (err) {
      status.value = "error";
      if (err instanceof ApiError) {
        message.value = `Could not file ${err.status}`;
      } else {
        message.value = "Could not file";
      }
    } finally {
      filing.value = false;
    }
  }

  return {
    status,
    message,
    projects,
    selectedId,
    harvest,
    sentence,
    nodeType,
    refId,
    files,
    filing,
    attachProjectId,
    applyFields,
    consumeShare,
    loadProjects,
    createProject,
    file,
  };
});
