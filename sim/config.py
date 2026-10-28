"""Typed factory configuration, loaded from config/*.yaml."""

from __future__ import annotations

from pathlib import Path

import yaml
from pydantic import BaseModel, Field

CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"


class ShiftBlock(BaseModel):
    start_hour: int
    end_hour: int
    multiplier: float


class Shade(BaseModel):
    probability: float
    volume_factor: float
    bod_mg_l: float
    conductivity_us_cm: float


class MeanSd(BaseModel):
    mean: float
    sd: float


class Production(BaseModel):
    daily_wastewater_m3: float
    batch_hours: int
    shift_profile: list[ShiftBlock]
    noise_rel: float
    shades: dict[str, Shade]
    raw_ph: MeanSd

    @property
    def mean_rate_m3_h(self) -> float:
        return self.daily_wastewater_m3 / 24.0

    def shift_multiplier(self, hour: int) -> float:
        for block in self.shift_profile:
            if block.start_hour < block.end_hour:
                if block.start_hour <= hour < block.end_hour:
                    return block.multiplier
            elif hour >= block.start_hour or hour < block.end_hour:
                return block.multiplier
        raise ValueError(f"hour {hour} is not covered by the shift profile")


class WaterSource(BaseModel):
    ph: float
    conductivity_us_cm: float


class Water(BaseModel):
    process_loss_fraction: float
    sludge_water_fraction: float
    reuse_fraction: float
    groundwater: WaterSource


class Equalization(BaseModel):
    volume_m3: float
    setpoint_fraction: float
    control_time_constant_h: float


class Etp(BaseModel):
    design_capacity_m3_day: float
    pump_max_m3_h: float
    equalization: Equalization
    aeration_basin_volume_m3: float
    clarifier_volume_m3: float
    residence_min_h: float
    residence_max_h: float
    treated_ph: MeanSd
    conductivity_removal_fraction: float


class Power(BaseModel):
    standby_kw: float
    base_kw: float
    pump_kw_per_m3_h: float
    aeration_kw_per_kg_bod_h: float
    aeration_response_h: float


class DischargeLimits(BaseModel):
    bod_mg_l: float
    ph_min: float
    ph_max: float


class Sensors(BaseModel):
    flow_noise_rel: float
    power_noise_rel: float
    ph_noise_abs: float
    conductivity_noise_rel: float
    tank_level_noise_abs: float
    tank_level_resolution_minutes: int


class Lab(BaseModel):
    interval_days: int


class FactoryConfig(BaseModel):
    id: str
    name: str
    timezone: str
    timestep_minutes: int = Field(gt=0)
    production: Production
    water: Water
    etp: Etp
    power: Power
    discharge_limits: DischargeLimits
    sensors: Sensors
    lab: Lab

    @property
    def dt_h(self) -> float:
        return self.timestep_minutes / 60.0

    @property
    def steps_per_day(self) -> int:
        return 24 * 60 // self.timestep_minutes


def load_factory(name: str = "factory") -> FactoryConfig:
    path = CONFIG_DIR / f"{name}.yaml"
    with path.open() as f:
        return FactoryConfig.model_validate(yaml.safe_load(f))


def config_name(factory_id: str) -> str:
    """The config file name (without .yaml) for a factory ID."""
    for path in sorted(CONFIG_DIR.glob("*.yaml")):
        with path.open() as f:
            if yaml.safe_load(f).get("id") == factory_id:
                return path.stem
    raise KeyError(factory_id)
