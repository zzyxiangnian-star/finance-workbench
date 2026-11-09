import { useCallback, useEffect, useMemo, useState } from "react";
import { createHashRouter, RouterProvider } from "react-router-dom";
import { Shell } from "./components/Shell";
import { getBackendConfig, ping, type BackendConfig } from "./lib/backend";
import { Ctx } from "./lib/context";
import { usePersistent } from "./lib/persist";
import { ROUTES } from "./lib/routes";
import { LedgerPage } from "./pages/LedgerPage";
import { Placeholder } from "./pages/Placeholder";
import { VoucherEntryPage } from "./pages/VoucherEntryPage";
import { createClient } from "./shared/api";

type Boot = { state: "loading" } | { state: "down"; reason: string } | { state: "ready"; cfg: BackendConfig };

function ServiceDown({ reason, onRetry, retrying }: { reason: string; onRetry: () => void; retrying: boolean }) {
  return (
    <div className="app boot">
      <div className="card">
        <h1 className="hero">本机服务未启动</h1>
        <p className="muted" style={{ margin: 0 }}>财务工作台需要先启动本机服务。在 services\core 目录里运行：</p>
        <code>{".venv\\Scripts\\activate\n$env:FW_DEMO=\"1\"; finance-core"}</code>
        <p className="cap" style={{ margin: 0 }}>{reason}</p>
        <div><button className="btn pri" type="button" onClick={onRetry} disabled={retrying}>{retrying ? "正在连接…" : "重试"}</button></div>
      </div>
    </div>
  );
}

const router = createHashRouter([
  {
    element: <Shell />,
    children: [
      { path: "/ledger/new", element: <VoucherEntryPage /> },
      { path: "/ledger/:id/edit", element: <VoucherEntryPage /> },
      { path: "/ledger", element: <LedgerPage /> },
      ...ROUTES.filter((r) => r.path !== "/ledger").map((r) => ({ path: r.path, element: <Placeholder /> })),
      { path: "*", element: <Placeholder /> },
    ],
  },
]);

export default function App() {
  const [boot, setBoot] = useState<Boot>({ state: "loading" });
  const [retrying, setRetrying] = useState(false);
  const [user, setUser] = usePersistent("user", "李会计");

  const connect = useCallback(async () => {
    setRetrying(true);
    try {
      const cfg = await getBackendConfig();
      if (!(await ping(cfg.baseUrl))) throw new Error(`连不上 ${cfg.baseUrl}`);
      setBoot({ state: "ready", cfg });
    } catch (e) {
      setBoot({ state: "down", reason: e instanceof Error ? e.message : String(e) });
    } finally {
      setRetrying(false);
    }
  }, []);

  useEffect(() => { connect(); }, [connect]);

  const api = useMemo(
    () => (boot.state === "ready" ? createClient({ ...boot.cfg, user }) : null),
    [boot, user],
  );

  if (boot.state === "loading") return <div className="app boot" />;
  if (boot.state === "down" || !api) {
    return <ServiceDown reason={boot.state === "down" ? boot.reason : ""} onRetry={connect} retrying={retrying} />;
  }

  return (
    <Ctx.Provider value={{ api, user, setUser }}>
      <RouterProvider router={router} />
    </Ctx.Provider>
  );
}
