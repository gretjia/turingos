# Home & Cloud SD-WAN Network Topology
*(Snapshot: 2026-03-01)*

## 1. Node Inventory & IP Details

| Node Name | Tailscale IP | Public IP / Network | Role & Environment |
| :--- | :--- | :--- | :--- |
| **Local Mac** (`zephrymac-studio`) | `100.72.87.94` | Local Network (Shenzhen) | Client machine |
| **HK Relay Node** (`vm-0-7-ubuntu`) | `100.81.234.55` | `43.161.252.57` | Tencent Cloud (Hong Kong) - Peer relay candidate / Optional exit |
| **US Node** (`omega-vm`) | `100.122.223.27` | `34.27.27.164` | Google Cloud (us-central1-c) - Preferred exit node / Computing brain |
| **Local Linux Worker** (`linux1-lx`) | `100.64.97.113` | `192.168.3.113` | Local intra-network compute node |
| **Local Windows Worker** (`windows1-w1`) | `100.123.90.25` | Local Network | Local intra-network compute node & Jump server |

## 2. Link Quality & Path Analysis
Based on empirical tests (2026-02-26):

*   **Shenzhen <-> HK (Tencent)**: Strong and stable. 0% loss, ~23ms RTT.
*   **HK <-> US (Google Cloud)**: Stable backbone connection. 0% loss, ~170ms RTT.
*   **Shenzhen <-> US (Direct)**: Poor quality with high loss and jitter. ~10-20% packet loss, ~360-380ms RTT.

## 3. SD-WAN Architecture Insights & Constraints
The current Tailscale mesh attempts to use the HK node as a peer relay to improve connection stability to the US node.

**Current Findings on Tailscale Multi-Hop:**
*   Tailscale path selection natively prioritizes: **Direct > Peer Relay > DERP**.
*   Attempts to force traffic through the optimal path (Shenzhen -> HK -> US) by blocking direct UDP ports on the US node resulted in Tailscale falling back to slower DERP relays rather than reliably locking onto the HK peer relay.
*   **Conclusion:** There is currently no native "single switch" in Tailscale to guarantee a fixed multi-hop routing chain.

## 4. Recommended Architectural Direction
If a strict `Shenzhen -> HK -> US` path is mandatory for optimal throughput and latency stability, an explicit double-tunnel architecture is recommended:
1.  **Fixed Entry Tunnel:** Use the Tailscale client -> HK tunnel as the fixed entry/egress anchor.
2.  **Backbone Tunnel:** Establish a separate site-to-site tunnel (e.g., WireGuard or IPsec) between the HK node and the US node, operating independently of Tailscale's path selection.
3.  **Policy Routing:** Configure routing policies on the HK node to unconditionally forward designated traffic into the HK->US backbone tunnel.
