# linux1-lx QwQ-32B Install Attempt (2026-02-28)

## Request
- Install local planner model `QwQ-32B` on `linux1-lx` and prepare for TuringOS planner routing.

## Actions Executed
1. Read SSH profile from `~/.ssh/config` and confirmed host alias:
   - `Host linux1-lx`
   - `HostName 100.64.97.113`
   - `User zepher`
2. Initial SSH succeeded once and returned:
   - hostname: `zepher-linux`
   - OS: Ubuntu 24.04 kernel `6.17.0-14-generic`
3. Verified sudo non-interactive availability (`sudo -n true` => exit 0).
4. Attempted Ollama install via official script.

## Blocker
- `linux1-lx` became unreachable over Tailscale during install phase:
  - `ssh linux1-lx` timed out
  - `tailscale ping linux1-lx` timed out from both `omega-vm` and `windows1-w1`
- Therefore model install could not be completed.

## Recommended Resume Commands (once host reachable)
```bash
sudo tailscale up --exit-node=<HK_NODE> --exit-node-allow-lan-access --accept-routes
curl -fsSL https://ollama.com/install.sh | sh
sudo systemctl enable --now ollama
ollama pull qwq:32b
ollama run qwq:32b "reply with strict json: {\"ok\":true}"
```

## Note
- For this task, HK exit-node route is preferred over domestic apt mirror because model pull traffic is primarily external HTTPS, not apt package traffic.
