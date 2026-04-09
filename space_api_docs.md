# Venturo Space API Documentation

## Authentication

### Login

- **URL:** `https://space-api.venturo.id/api/v1/auth/login`
- **Method:** `POST`

#### Request Payload
```json
{
  "email": "nur.syahfei@gmail.com",
  "password": "your_password",
  "remember_me": false
}
```
*(Catatan: field `remember_me` bersifat opsional)*

#### Response Structure (Verified)
```json
{
  "status_code": 200,
  "data": {
    "access_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
    "token_type": "bearer",
    "user": {
      "id": 63,
      "nama": "Nur Syahfei",
      "email": "nur.syahfei@gmail.com",
      "jabatan": "Lead Web Programmer",
      "role": { "id": 0, "nama": "User", "akses": "{...}" }
    }
  },
  "message": "",
  "settings": []
}
```
- **Token path:** `data.access_token`
- **Tidak ada refresh token** — re-login jika expired/401

## Tasks & Sprints

### Get Sprint Issues (Tasks)

- **URL:** `https://space-api.venturo.id/api/v3/sprint-issues`
- **Method:** `GET`

#### Query Parameters
Endpoint ini menerima beberapa query parameter untuk memfilter data:
- `project_id`: ID dari project yang bersangkutan (contoh: `194`)
- `t_sprint_id`: ID dari sprint (contoh: `null` atau ID spesifik)
- `start_date`: Format YYYY-MM-DD (contoh: `2026-04-06`)
- `end_date`: Format YYYY-MM-DD (contoh: `2026-04-10`)
- `isUncategorized`: Parameter boolean (`true` / `false`)
- `department_id`: (Opsional) Filter berdasarkan departemen

#### Response Structure (Overview)
API akan mengembalikan JSON yang berisi object utama:
- `status_code`: 200
- `data`:
  - `dataIssues`: Array of object (Berisi detail tiket seperti `id`, `name`, `code_issue` (mis. QTRU-3896), `point`, `duedate`, `user_auth_name`, `tag_name`)
  - `totalIssue`: Jumlah tiket
  - `dataPoint`: Summary point/estimasi

### Create Issue (Task)

- **URL:** `https://space-api.venturo.id/api/v3/issues`
- **Method:** `POST`

#### Request Payload
Saat membuat task/tiket baru, payload JSON yang dikirimkan memiliki struktur seperti berikut:
```json
{
  "name": "Judul Task",
  "description": "Deskripsi dari task tersebut.",
  "t_sprint_id": 6803,
  "assignee_id": 1234,
  "point": 0,
  "tag_id": null,
  "feature_id": null
}
```

### Edit Issue (Task)

- **URL:** `https://space-api.venturo.id/api/v3/issues/{issue_id}` (Ganti `{issue_id}` dengan ID internal tiket, misal `3924`)
- **Method:** `PATCH` (atau `PUT`)

#### Request Payload
Endpoint edit bersifat *partial update*, sehingga hanya perlu mengirimkan *field* yang diubah. Contoh jika hanya mengubah judul:
```json
{
  "name": "Judul Task yang telat di edit"
}
```
