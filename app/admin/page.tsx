import AdminForm from "@/components/AdminForm.tsx";
import { CONFIG, KIND_LABEL, KINDS } from "@/lib/config.ts";

export const metadata = { title: "Generate reports" };

export default function AdminPage() {
  return (
    <>
      <h1 className="page">Generate reports</h1>
      <p className="sub">Reports are written automatically every morning. Use this page to write one now, or to rewrite one.</p>
      <AdminForm
        instruments={Object.entries(CONFIG.instruments).map(([code, i]) => ({ code, name: i.name }))}
        kinds={KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
      />
    </>
  );
}
