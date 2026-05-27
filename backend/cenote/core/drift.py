"""Drift detection — field-by-field comparison with severity.

Principio fundamental: CERO falsos positivos. Solo se comparan campos listados
en DRIFT_FIELDS para el tipo. Cualquier otra diferencia (timestamps, IDs internos,
campos default de AWS) se ignora.

Normalización por campo:
- Listas: ordenadas si el campo es un set (sg ids, subnets) → no ordenadas si es ordenado (rules, routes)
- Maps: comparados como dicts
- Nones vs strings vacíos vs faltantes: tratados como equivalentes
"""

from __future__ import annotations

from typing import Any

from cenote.catalogs.drift_fields import DRIFT_FIELDS
from cenote.core.models import DriftField, DriftSeverity

# Campos que son colecciones desordenadas (sets, comparar como conjunto)
_UNORDERED_SET_FIELDS: dict[str, set[str]] = {
    "aws_instance": {"vpc_security_group_ids"},
    "aws_lb": {"subnets", "security_groups"},
    "aws_db_instance": {"vpc_security_group_ids"},
    "aws_lambda_function": set(),  # vpc_config compared as dict
}


def _normalize(field: str, value: Any, tf_type: str) -> Any:
    """Normaliza un valor para comparación robusta."""
    if value is None:
        return None
    # Trata strings vacíos como None
    if isinstance(value, str) and not value.strip():
        return None
    # Trata listas vacías y dicts vacíos como None
    if isinstance(value, (list, dict)) and len(value) == 0:
        return None
    # Sets desordenados → ordenar
    unordered = _UNORDERED_SET_FIELDS.get(tf_type, set())
    if field in unordered and isinstance(value, list):
        try:
            return sorted(value)
        except TypeError:
            return value
    return value


def _equivalent(a: Any, b: Any) -> bool:
    """Comparación tolerante a tipos vacíos / Nones."""
    if a is None and b is None:
        return True
    if (a is None) != (b is None):
        return False
    return a == b


def compute_drift(
    tf_type: str,
    tf_attrs: dict[str, Any],
    aws_attrs: dict[str, Any],
) -> list[DriftField]:
    """Returns the list of fields that differ between TF and AWS.

    Only compares fields listed in DRIFT_FIELDS[tf_type]. Everything else is ignored.
    """
    fields_table = DRIFT_FIELDS.get(tf_type)
    if not fields_table:
        return []

    drift: list[DriftField] = []
    for field, severity in fields_table.items():
        tf_val = _normalize(field, tf_attrs.get(field), tf_type)
        aws_val = _normalize(field, aws_attrs.get(field), tf_type)
        if _equivalent(tf_val, aws_val):
            continue
        drift.append(DriftField(
            field=field,
            tf_value=tf_val,
            aws_value=aws_val,
            severity=severity,
        ))

    return drift


def overall_severity(drift: list[DriftField]) -> DriftSeverity | None:
    """Returns the max severity present in a drift list (or None if no drift)."""
    if not drift:
        return None
    order = {DriftSeverity.LOW: 1, DriftSeverity.MEDIUM: 2, DriftSeverity.HIGH: 3}
    return max((d.severity for d in drift), key=lambda s: order[DriftSeverity(s)])
