# TuringOS Network Topology Runbook (2026-03-01)

This document freezes the usable network topology and operating rules for cross-host TuringOS runs.

Source of truth imported from:

- `/Users/zephryj/work/network/README.md`
- `/Users/zephryj/work/network/handover.md`
- `/Users/zephryj/work/network/TAILSCALE_SDWAN_DEPLOYMENT.md`

## 1) Canonical Topology

| Node | Public IP | Tailscale IP | Primary Role |
|---|---|---|---|
| `vm-0-7-ubuntu` (HK) | `43.161.252.57` | `100.81.234.55` | Relay candidate / optional exit node |
| `omega-vm` (US) | `34.27.27.164` | `100.122.223.27` | Recommended exit node / control host |
| `zephrymac-studio` (Mac) | local LAN | `100.72.87.94` | Local planner/client |
| `windows1-w1` (Windows) | local LAN | `100.123.90.25` | Worker host candidate |
| `linux1-lx` (Linux worker) | local LAN | `100.64.97.113` | Worker host candidate |

## 2) Stable Operating Modes

- `Direct mode`:
  - no exit node
  - use when debugging local route instability
- `US exit mode (recommended)`:
  - set exit node to `100.122.223.27` (`omega-vm`)
  - current safest default for OpenAI/Cloudflare access
- `HK exit mode (optional)`:
  - set exit node to `100.81.234.55` (`vm-0-7-ubuntu`)
  - may trigger region/IP risk controls (for example `403`)
- `Option 2 (HK relay + US exit)`:
  - HK kept as relay candidate
  - US kept as only exit node
  - health-guard script performs auto-heal and fail-open fallback

## 3) Route Selection Reality

- Tailscale path preference is effectively:
  - `direct > peer relay > DERP`
- There is no single official switch that guarantees deterministic multi-hop `Shenzhen -> HK -> US`.
- Experimental forced chain rules can degrade into `DERP(ord)` fallback and instability.

## 4) Required Baseline Checks

Run on local control host before long tests:

```bash
tailscale status
tailscale debug prefs | jq -r '{ExitNodeID,RouteAll,CorpDNS,AdvertiseRoutes}'
curl -4 -m 8 -s https://ifconfig.me/ip || echo failed
```

Expected in US-exit mode:

- `ExitNodeID` is non-empty.
- Public egress IP matches `34.27.27.164` (US node egress identity).

## 5) Critical Failure Patterns

- Symptom: no internet right after selecting exit node.
  - First rollback locally:
    - `tailscale set --exit-node=`
  - Then check exit node forwarding:
    - `sysctl net.ipv4.ip_forward` must be `1` on exit host.
- Symptom: network alive but OpenAI/Cloudflare returns `403`.
  - Usually risk control on current egress IP, not SD-WAN outage.
  - Prefer US exit mode.
- Symptom: direct path force attempts collapse.
  - If chain forcing falls back to DERP or flaps, stop forcing and return to US exit baseline.

## 6) Known Scripts (External Workspace)

External scripts live in `/Users/zephryj/work/network`:

- `apply_option2.sh`: apply HK-relay + US-exit baseline.
- `option2_health_guard.sh`: periodic heal/fallback guard.
- `force_hk_chain.sh`: experimental forcing tool, not production-safe.

Use these scripts as operational reference; do not assume deterministic forced multi-hop behavior.

## 7) TuringOS Integration Guidance

- Planner/control lane can stay on Mac/local.
- Worker lanes should prefer hosts with stable OpenAI-compatible model endpoints.
- For Windows worker bootstrap, verify exit-node mode first when package/model downloads are required.
- Keep runbooks aligned with actual Tailscale status snapshots before scaling workers.

## 8) Controller vs Compute Routing Rule

- Project control plane host is `omega-vm` (orchestrator/controller).
- Primary compute/data-plane hosts are local `Mac + Windows`.
- Even when all devices exist in one physical LAN, controller traffic may still traverse relay paths depending on execution point.
- For large package delivery to Windows:
  - Prefer Mac-side download/staging.
  - Use Mac LAN IP (`192.168.3.x`) to Windows LAN IP (`192.168.3.x`) transfer.
  - Then bootstrap Windows from local archive path.
- Automation helper:
  - `scripts/windows_worker/bootstrap_windows_worker_via_mac_lan.sh`

## 9) Security Notes

- The external network `.env` handover mentions a Tailscale auth key snapshot.
- Treat it as sensitive and rotate after takeover.
- Do not commit private keys or live secrets into this repository.

## 10) Agent Networking & SSH Memories

- The central orchestrator/controller is `omega-vm`. The user SSHes into `omega-vm` to issue commands and control the other compute hosts in the home network (Mac, Windows, and Linux).
- When the user refers to "linux" generally, they mean the Tailscale node `linux1-lx` (`100.64.97.113`), not the `omega-vm` controller node.
- SSH alias `mac-back` connects to the user's Mac via a reverse tunnel on `localhost:2222` (Key: `~/.ssh/id_ed25519_mac_backssh`).
- SSH aliases `linux1-lx` and `windows1-w1` use the dedicated key `~/.ssh/id_ed25519_omega_workers` for automated access from `omega-vm`.
- SSH aliases `mac-back`, `linux1-lx`, and `windows1-w1` are configured on `omega-vm` for direct access to the home network.
- **GFW/Download Strategy**: When downloading dependencies or models, always prioritize **domestic mirrors** first. If a domestic mirror fails, is too slow, or is unavailable, configure your tools (npm, pip, curl, etc.) to use the Mac's commercial VPN proxy at port `7897` (use `127.0.0.1:7897` if executing directly on the Mac, or the Mac's Tailscale/LAN IP at `100.72.87.94:7897` if executing from other nodes).