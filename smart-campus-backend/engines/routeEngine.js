const GRAPH = {
  "LAB": {
    "CLASSROOM": 4,
    "SECURITY CENTER": 3
  },
  "CLASSROOM": {
    "LAB": 4,
    "SECURITY CENTER": 2
  },
  "SECURITY CENTER": {
    "LAB": 3,
    "CLASSROOM": 2,
    "CANTEEN": 3,
    "PARKING": 4,
    "MAIN GATE": 5
  },
  "CANTEEN": {
    "SECURITY CENTER": 3
  },
  "PARKING": {
    "SECURITY CENTER": 4,
    "MAIN GATE": 2
  },
  "MAIN GATE": {
    "SECURITY CENTER": 5,
    "PARKING": 2
  }
};

function dijkstra(source, destination = "MAIN GATE", blocked = new Set(), penalties = {}) {
  const distances = {};
  const previous = {};
  const visited = new Set();
  const nodes = Object.keys(GRAPH);

  for (const node of nodes) distances[node] = Infinity;
  distances[source] = 0;

  while (visited.size < nodes.length) {
    let current = null;
    let best = Infinity;

    for (const node of nodes) {
      if (!visited.has(node) && !blocked.has(node) && distances[node] < best) {
        best = distances[node];
        current = node;
      }
    }

    if (current === null) break;
    if (current === destination) break;

    visited.add(current);

    for (const [neighbor, weight] of Object.entries(GRAPH[current])) {
      if (blocked.has(neighbor)) continue;

      const extra = Number(penalties[neighbor] || 0);
      const candidate = distances[current] + weight + extra;

      if (candidate < distances[neighbor]) {
        distances[neighbor] = candidate;
        previous[neighbor] = current;
      }
    }
  }

  if (!Number.isFinite(distances[destination])) {
    return { route: [], totalCost: null };
  }

  const route = [];
  let current = destination;

  while (current) {
    route.unshift(current);
    current = previous[current];
  }

  return {
    route,
    totalCost: distances[destination]
  };
}

module.exports = { dijkstra, GRAPH };
