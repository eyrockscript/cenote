"""DuckDB-backed storage for snapshots, resources, and edges.

Each scan creates a new snapshot. Resources and edges are stored as JSON blobs
to keep the schema flexible while DuckDB indexes by (snapshot_id, arn).

Why DuckDB:
- Embedded (no extra container)
- Columnar with great JSON ops
- Recursive CTEs for blast_radius
- Single file → easy backup, easy to nuke
"""

import json
from datetime import datetime
from pathlib import Path

import duckdb

from cenote.core.models import Edge, Graph, Resource, Snapshot, SnapshotSource


class DuckDBStore:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)

    def _conn(self) -> duckdb.DuckDBPyConnection:
        return duckdb.connect(str(self.db_path))

    def init_schema(self) -> None:
        with self._conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS snapshots (
                    id VARCHAR PRIMARY KEY,
                    account_id VARCHAR NOT NULL,
                    region VARCHAR NOT NULL,
                    created_at TIMESTAMP NOT NULL,
                    source VARCHAR NOT NULL,
                    resource_count INTEGER DEFAULT 0,
                    drift_count INTEGER DEFAULT 0,
                    orphan_count INTEGER DEFAULT 0,
                    declared_only_count INTEGER DEFAULT 0
                );
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS resources (
                    snapshot_id VARCHAR NOT NULL,
                    arn VARCHAR NOT NULL,
                    type VARCHAR NOT NULL,
                    name VARCHAR,
                    region VARCHAR,
                    state VARCHAR,
                    has_drift BOOLEAN DEFAULT FALSE,
                    data JSON NOT NULL,
                    PRIMARY KEY (snapshot_id, arn)
                );
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS edges (
                    snapshot_id VARCHAR NOT NULL,
                    source VARCHAR NOT NULL,
                    target VARCHAR NOT NULL,
                    type VARCHAR NOT NULL,
                    metadata JSON,
                    discovered_via VARCHAR
                );
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_resources_snap_type
                  ON resources (snapshot_id, type);
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_edges_snap_source
                  ON edges (snapshot_id, source);
            """)

    def save_snapshot(self, snapshot: Snapshot, graph: Graph) -> None:
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO snapshots
                  (id, account_id, region, created_at, source,
                   resource_count, drift_count, orphan_count, declared_only_count)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    snapshot.id,
                    snapshot.account_id,
                    snapshot.region,
                    snapshot.created_at,
                    snapshot.source.value if isinstance(snapshot.source, SnapshotSource) else snapshot.source,
                    snapshot.resource_count,
                    snapshot.drift_count,
                    snapshot.orphan_count,
                    snapshot.declared_only_count,
                ],
            )
            for node in graph.nodes:
                conn.execute(
                    """
                    INSERT INTO resources (snapshot_id, arn, type, name, region, state, has_drift, data)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        snapshot.id,
                        node.id,
                        node.type,
                        node.name,
                        node.region,
                        node.state,
                        bool(node.drift),
                        node.model_dump_json(),
                    ],
                )
            for edge in graph.edges:
                conn.execute(
                    """
                    INSERT INTO edges (snapshot_id, source, target, type, metadata, discovered_via)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    [
                        snapshot.id,
                        edge.source,
                        edge.target,
                        edge.type,
                        json.dumps(edge.metadata),
                        edge.discovered_via,
                    ],
                )

    def list_snapshots(self) -> list[Snapshot]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT id, account_id, region, created_at, source, resource_count, "
                "drift_count, orphan_count, declared_only_count "
                "FROM snapshots ORDER BY created_at DESC"
            ).fetchall()
        return [
            Snapshot(
                id=r[0],
                account_id=r[1],
                region=r[2],
                created_at=r[3],
                source=r[4],
                resource_count=r[5],
                drift_count=r[6],
                orphan_count=r[7],
                declared_only_count=r[8],
            )
            for r in rows
        ]

    def get_graph(self, snapshot_id: str) -> Graph:
        with self._conn() as conn:
            nodes_rows = conn.execute(
                "SELECT data FROM resources WHERE snapshot_id = ?",
                [snapshot_id],
            ).fetchall()
            edges_rows = conn.execute(
                "SELECT source, target, type, metadata, discovered_via "
                "FROM edges WHERE snapshot_id = ?",
                [snapshot_id],
            ).fetchall()

        nodes = [Resource.model_validate_json(r[0]) for r in nodes_rows]
        edges = [
            Edge(
                source=r[0],
                target=r[1],
                type=r[2],
                metadata=json.loads(r[3]) if r[3] else {},
                discovered_via=r[4] or "aws_describe",
            )
            for r in edges_rows
        ]
        return Graph(snapshot_id=snapshot_id, nodes=nodes, edges=edges)

    def delete_snapshot(self, snapshot_id: str) -> bool:
        """Delete a snapshot and all its associated resources/edges.

        Returns True if the snapshot existed and was deleted, False if it did not.
        """
        with self._conn() as conn:
            existing = conn.execute(
                "SELECT 1 FROM snapshots WHERE id = ?", [snapshot_id]
            ).fetchone()
            if not existing:
                return False
            conn.execute("DELETE FROM resources WHERE snapshot_id = ?", [snapshot_id])
            conn.execute("DELETE FROM edges WHERE snapshot_id = ?", [snapshot_id])
            conn.execute("DELETE FROM snapshots WHERE id = ?", [snapshot_id])
        return True

    def delete_all_snapshots(self) -> int:
        """Wipe every snapshot. Returns the count deleted."""
        with self._conn() as conn:
            count = conn.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0]
            conn.execute("DELETE FROM resources")
            conn.execute("DELETE FROM edges")
            conn.execute("DELETE FROM snapshots")
        return int(count)
