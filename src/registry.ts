/**
 * Function Registry — defines all available Space Venturo API operations.
 * Used by the `search` and `execute` meta-tools.
 */

import { SpaceVenturoClient } from "./client.js";
import { z } from "zod";

const ProjectSchema = z.object({
  id: z.number().or(z.string()),
  name: z.string(),
  slug: z.string().nullable().optional(),
  id_project_team: z.number().or(z.string()).nullable().optional()
}).passthrough();

const IssueSchema = z.object({
  id: z.number().or(z.string()),
  name: z.string(),
  code_issue: z.string().nullable().optional(),
  point: z.number().nullable().optional().or(z.string()),
  duedate: z.string().nullable().optional(),
  user_auth_name: z.string().nullable().optional(),
  tag_name: z.string().nullable().optional(),
  status_sprint: z.object({
    name: z.string().nullable().optional()
  }).passthrough().nullable().optional()
}).passthrough();

export interface ParamDef {
  type: string;
  description: string;
  required: boolean;
  enum?: string[];
}

export interface FunctionDef {
  name: string;
  description: string;
  params: Record<string, ParamDef>;
  destructive?: boolean; // requires confirm: true
  handler: (client: SpaceVenturoClient, params: Record<string, unknown>) => Promise<unknown>;
}

export function buildRegistry(client: SpaceVenturoClient): FunctionDef[] {
  return [
    // ── Projects ──────────────────────────────────────────────────────────

    {
      name: "get_projects",
      description: "List all projects the current user has access to. Returns project id, name, and slug.",
      params: {},
      handler: async (cli) => {
        await cli.ensureAuth();
        const query: Record<string, string | number> = {};
        if (cli.userId) query.user_auth_id = cli.userId;
        if (cli.aksesNama) query.akses_nama = cli.aksesNama;
        
        const res = await cli.get<any>("/api/v1/project-team", query);
        if (res.data?.dataProject) {
            const parsedData = z.array(ProjectSchema).parse(res.data.dataProject);
            res.data = parsedData.map((p) => ({
                id: p.id,
                name: p.name,
                slug: p.slug,
                id_project_team: p.id_project_team
            }));
        }
        return res;
      },
    },

    // ── Tasks & Sprints ───────────────────────────────────────────────────

    {
      name: "get_sprint_issues",
      description: "List all sprint issues / tasks. Response is filtered to show essential fields only.",
      params: {
        project_id: { type: "number", description: "Filter by project ID", required: false },
        t_sprint_id: { type: "number", description: "Filter by sprint ID (optional)", required: false },
        start_date: { type: "string", description: "Filter start date (optional)", required: false },
        end_date: { type: "string", description: "Filter end date (optional)", required: false },
        isUncategorized: { type: "boolean", description: "Show uncategorized issues", required: false },
        department_id: { type: "number", description: "Filter by department ID", required: false },
      },
      handler: async (cli, p) => {
        const query: Record<string, string | number | boolean | undefined | null> = {
          project_id: (p.project_id as number) ?? cli.defaultProjectId,
        };
        
        if (!query.project_id) throw new Error("project_id is required either via arguments or default settings");
        
        if (p.t_sprint_id !== undefined) query.t_sprint_id = p.t_sprint_id as number;
        
        // --- 🛡️ Hardening: Tanggal wajib diisi jika Sprint ID kosong ---
        if (p.start_date !== undefined) {
          query.start_date = p.start_date as string;
        } else if (p.t_sprint_id === undefined) {
          query.start_date = new Date().toISOString().split('T')[0];
        }

        if (p.end_date !== undefined) {
          query.end_date = p.end_date as string;
        } else if (p.t_sprint_id === undefined) {
          query.end_date = new Date().toISOString().split('T')[0];
        }

        // --- 🛡️ Hardening: Uncategorized diset false secara default ---
        // Penarikan data backlog tanpa kategori sering menyebabkan 504 Timeout.
        query.isUncategorized = p.isUncategorized !== undefined ? (p.isUncategorized as boolean) : false;
        
        if (p.department_id !== undefined) query.department_id = p.department_id as number;
        
        const res = await cli.get<any>("/api/v3/sprint-issues", query);
        
        if (res.data?.dataIssues) {
            const parsedIssues = z.array(IssueSchema).parse(res.data.dataIssues);
            res.data.dataIssues = parsedIssues.map((issue) => ({
                id: issue.id,
                name: issue.name,
                code: issue.code_issue,
                point: issue.point,
                duedate: issue.duedate,
                assignee: issue.user_auth_name,
                tag: issue.tag_name,
                status: issue.status_sprint?.name || "Unknown"
            }));
        }
        return res;
      },
    },

    {
      name: "create_issue",
      description: "Create a new issue/task in a sprint.",
      params: {
        name: { type: "string", description: "Issue title/name", required: true },
        t_sprint_id: { type: "number", description: "Sprint ID where the issue belongs", required: true },
        description: { type: "string", description: "Detailed description of the issue (optional)", required: false },
        assignee_id: { type: "number", description: "Assignee user ID (optional)", required: false },
        point: { type: "number", description: "Story points (optional, defaults to 0)", required: false },
        tag_id: { type: "number", description: "Tag ID (optional)", required: false },
        feature_id: { type: "number", description: "Feature ID (optional)", required: false },
      },
      handler: async (cli, p) => {
        const body = {
            name: p.name,
            t_sprint_id: p.t_sprint_id,
            description: p.description ?? "",
            assignee_id: p.assignee_id ?? null,
            point: p.point ?? 0,
            tag_id: p.tag_id ?? null,
            feature_id: p.feature_id ?? null
        };
        return cli.post("/api/v3/issues", body);
      },
    },

    {
      name: "update_issue",
      description: "Update an existing issue. This is a partial update.",
      params: {
        id: { type: "number", description: "Issue internal ID", required: true },
        name: { type: "string", description: "New issue title/name (optional)", required: false },
        description: { type: "string", description: "New description (optional)", required: false },
        assignee_id: { type: "number", description: "New assignee user ID (optional)", required: false },
        point: { type: "number", description: "New story points (optional)", required: false },
        tag_id: { type: "number", description: "New tag ID (optional)", required: false },
        confirm: { type: "boolean", description: "Must be true to confirm update", required: true },
      },
      destructive: true,
      handler: async (cli, p) => {
        if (!p.confirm) throw new Error("Set confirm: true to proceed with this update action.");
        
        const { id, confirm, ...bodyUpdates } = p;
        
        if (Object.keys(bodyUpdates).length === 0) {
            throw new Error("No update fields provided.");
        }
        // The Venturo API uses PATCH on /api/v1/issues/{id} for updates.
        return cli.patch(`/api/v1/issues/${id}`, bodyUpdates);
      },
    },

    {
      name: "delete_issue",
      description: "Delete an issue. This action is irreversible.",
      params: {
        id: { type: "number", description: "Issue internal ID", required: true },
        confirm: { type: "boolean", description: "Must be true to confirm deletion", required: true },
      },
      destructive: true,
      handler: async (cli, p) => {
        if (!p.confirm) throw new Error("Set confirm: true to proceed with this destructive action.");
        return cli.delete(`/api/v1/issues/${p.id}`);
      },
    },

    // ── Timebox ───────────────────────────────────────────────────────────

    {
      name: "get_timebox_team",
      description: "Get the Timebox team list for the current user.",
      params: {},
      handler: async (cli) => {
        await cli.ensureAuth();
        const query: Record<string, string | number> = {};
        if (cli.userId) query.user_auth_id = cli.userId;
        if (cli.humanisId) query.humanis_id = cli.humanisId;
        const res = await cli.get<any>("/api/v1/get-team", query, "timebox");
        if (Array.isArray(res.data)) {
            res.data = res.data.map((m: any) => ({
                user_auth_id: m.user_auth_id,
                nama: m.nama,
                jabatan: m.jabatan_nama || m.jabatan
            }));
        }
        return res;
      },
    },

    {
      name: "get_timebox_projects",
      description: "Get the listing of projects from Timebox.",
      params: {},
      handler: async (cli) => {
        await cli.ensureAuth();
        const query: Record<string, string | number> = {};
        if (cli.userId) query.user_auth_id = cli.userId;
        const res = await cli.get<any>("/api/v1/get-project", query, "timebox");
        if (Array.isArray(res.data)) {
            res.data = res.data.map((p: any) => ({ id: p.id, name: p.name }));
        }
        return res;
      },
    },

    {
      name: "get_timebox_scheduled",
      description: "Get scheduled tasks from Timebox (e.g. for today).",
      params: {
        path: { type: "string", description: "Path (default: 'scheduled')", required: false },
        position: { type: "string", description: "Position (default: 'today')", required: false },
        use_cache: { type: "boolean", description: "Whether to use cache (default: true)", required: false },
      },
      handler: async (cli, p) => {
        await cli.ensureAuth();
        const query: Record<string, string | number | boolean> = {
          path: (p.path as string) || "scheduled",
          position: (p.position as string) || "today",
          use_cache: p.use_cache !== undefined ? (p.use_cache as boolean) : true,
        };
        if (cli.userId) query.user_auth_id = cli.userId;
        const res = await cli.get<any>("/api/v1/scheduled", query, "timebox");
        if (res.data) {
            const mapTask = (t: any) => ({
                id: t.id,
                name: t.name,
                point: t.point,
                jam: t.jam,
                date: t.date,
                completed: t.completed,
                project_id: t.m_project_id
            });
            if (res.data.overdue) res.data.overdue = res.data.overdue.map(mapTask);
            if (res.data.today) res.data.today = res.data.today.map(mapTask);
            if (res.data.tomorrow) res.data.tomorrow = res.data.tomorrow.map(mapTask);
            if (res.data.afterTomorrow) res.data.afterTomorrow = res.data.afterTomorrow.map(mapTask);
        }
        return res;
      },
    },

    {
      name: "get_timebox_squad",
      description: "Get the squad list from Timebox.",
      params: {
        yesterDate: { type: "string", description: "Filter date format YYYY-MM-DD (optional)", required: false },
      },
      handler: async (cli, p) => {
        await cli.ensureAuth();
        const query: Record<string, string | number> = {};
        if (cli.userId) query.user_auth_id = cli.userId;
        if (cli.humanisId) query.humanis_id = cli.humanisId;
        if (p.yesterDate) query.yesterDate = p.yesterDate as string;
        const res = await cli.get<any>("/api/v1/my-squad/list", query, "timebox");
        if (Array.isArray(res.data)) {
            res.data = res.data.map((s: any) => ({
                id: s.user_auth_id,
                name: s.nama,
                position: s.jabatan_nama || s.jabatan
            }));
        }
        return res;
      },
    },

    {
      name: "get_timebox_summary",
      description: "Get summary counts from Timebox.",
      params: {},
      handler: async (cli) => {
        await cli.ensureAuth();
        const query: Record<string, string | number> = {};
        if (cli.userId) query.user_auth_id = cli.userId;
        if (cli.humanisId) query.humanis_id = cli.humanisId;
        return cli.get("/api/v1/summary-count", query, "timebox");
      },
    },

    {
      name: "update_timebox_task",
      description: "Update a Timebox task. Requires full task object or at least the fields to be updated.",
      params: {
        id: { type: "number", description: "The task ID", required: true },
        payload: { type: "object", description: "The full task object to be updated", required: true },
        confirm: { type: "boolean", description: "Must be true to confirm", required: true },
      },
      destructive: true,
      handler: async (cli, p) => {
        if (!p.confirm) throw new Error("Set confirm: true to proceed with this action.");
        await cli.ensureAuth();
        const id = p.id as number;
        const body = p.payload as any;
        
        // Ensure user_auth_id is set in body if available
        if (cli.userId && !body.user_auth_id) body.user_auth_id = cli.userId;
        
        return cli.put(`/api/v3/timebox/task/${id}`, body);
      },
    },

    {
      name: "create_timebox_task",
      description: "Create a new Timebox task.",
      params: {
        name: { type: "string", description: "Task name", required: true },
        description: { type: "string", description: "Task description", required: false },
        duedate: { type: "string", description: "Due date in YYYY-MM-DD", required: true },
        jam: { type: "string", description: "Time string (empty for none)", required: false },
        point: { type: "number", description: "Points/estimation (default: 0)", required: false },
        m_project_id: { type: "number", description: "Project ID (default: 0)", required: false },
      },
      handler: async (cli, p) => {
        await cli.ensureAuth();
        const body: Record<string, any> = {
          name: p.name,
          description: p.description || "",
          duedate: p.duedate,
          jam: p.jam || "",
          point: p.point !== undefined ? p.point : 0,
          user_auth_id: cli.userId,
          created_by: cli.userId,
          m_project_id: p.m_project_id || 0,
          m_project_status: 0,
          type_repetition: "",
          issue_acceptance: [],
          type: null,
          status: "1",
          results_url: [],
        };
        
        return cli.post("/api/v3/timebox/task", body);
      },
    },

    // ── Metadata Discovery (Space) ────────────────────────────────────────

    {
      name: "get_sprints",
      description: "List all sprints for a specific project.",
      params: {
        project_id: { type: "number", description: "The project ID", required: true },
      },
      handler: async (cli, p) => {
        await cli.ensureAuth();
        const res = await cli.get<any>(`/api/v1/get-date-sprint`, {
          m_project_id: p.project_id as number,
          active_sprint: false,
          notStart: true,
          sortByActive: true
        });
        
        if (!res.data) return res;
        return {
          ...res,
          data: res.data.map((s: any) => ({
            id: s.id,
            name: s.name,
            status: s.status,
            start_date: s.start_date,
            end_date: s.end_date
          }))
        };
      },
    },



    {
      name: "get_project_tags",
      description: "Get all tags/labels available in a project.",
      params: {
        project_id: { type: "number", description: "The project ID", required: true },
      },
      handler: async (cli, p) => {
        await cli.ensureAuth();
        const res = await cli.get<any>(`/api/v3/project-tag`, { project_id: p.project_id as number });
        if (!res.data?.list) return res;
        return {
          ...res,
          data: res.data.list.map((t: any) => ({
            id: t.id,
            name: t.name,
            color: t.color
          }))
        };
      },
    },

    {
      name: "get_roles",
      description: "Get list of available project roles (humanis positions).",
      params: {},
      handler: async (cli) => {
        await cli.ensureAuth();
        const res = await cli.get<any>(`/api/v3/humanis-position`);
        if (!res.data) return res;
        return {
          ...res,
          data: res.data.map((r: any) => ({ id: r.id, name: r.name }))
        };
      },
    },

    {
      name: "get_project_modules",
      description: "Get project module/feature structure.",
      params: {
        project_id: { type: "number", description: "The project ID", required: true },
      },
      handler: async (cli, p) => {
        await cli.ensureAuth();
        const res = await cli.get<any>(`/api/v1/module`, { m_project_id: p.project_id as number });
        if (!res.data) return res;
        
        // Simple mapper for modules
        const mapModule = (m: any) => ({
          id: m.id,
          name: m.ParentFeature || m.ChildName,
          children: m.ChildFeature ? m.ChildFeature.map((c: any) => ({ id: c.id, name: c.ChildName })) : undefined
        });

        return {
          ...res,
          data: res.data.map(mapModule)
        };
      },
    },

    {
      name: "get_project_details",
      description: "Get detailed information about a specific project.",
      params: {
        project_id: { type: "number", description: "The project ID", required: true },
      },
      handler: async (cli, p) => {
        await cli.ensureAuth();
        const res = await cli.get<any>(`/api/v1/project/${p.project_id}`, { id: p.project_id as number, with_sa: true });
        if (!res.data) return res;
        
        return {
          ...res,
          data: {
            id: res.data.id,
            name: res.data.name,
            description: res.data.description,
            project_team: res.data.project_team?.map((m: any) => ({
              user_id: m.user_auth_id,
              name: m.user?.nama,
              email: m.user?.email,
              role_id: m.m_roles_id
            }))
          }
        };
      },
    },

    {
      name: "get_project_team",
      description: "List members belonging to a specific project. Use this to find assignee_id (user_id).",
      params: {
        project_id: { type: "number", description: "The project ID", required: true },
      },
      handler: async (cli, p) => {
        await cli.ensureAuth();
        const res = await cli.get<any>(`/api/v1/project-team`, { 
            m_project_id: p.project_id as number,
            user_auth_id: cli.userId,
            akses_nama: cli.aksesNama
        });
        if (!res.data) return res;
        
        // Filter only for the desired project and simplify
        return {
          ...res,
          data: res.data
            .filter((item: any) => Number(item.m_project_id) === p.project_id)
            .map((item: any) => ({
                user_id: item.user_auth_id,
                name: item.user_auth_name,
                shortname: item.user_shortname
            }))
        };
      },
    },
  ];
}
