import rulesData from "../validation_rules.json";
import { INDICATOR_CODES, IndicatorCode, IndicatorValues, ValidationError, ValidationRules } from "../types";

const validationRules = rulesData as ValidationRules;

export interface ReportValidationResult {
  errors: ValidationError[];
  warnings: ValidationError[];
}

function isEnteredInteger(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function requiredError(code: IndicatorCode): ValidationError {
  return {
    field: code,
    message: `${code} là bắt buộc và phải là số nguyên không âm.`,
    severity: "error",
  };
}

/**
 * Client-side preview of the deterministic report rules.
 *
 * A missing value is never converted to zero. Relationship checks only run
 * after every referenced field contains a valid non-negative integer; this
 * keeps the form from showing misleading relationship errors while a user is
 * still entering a report. The backend remains the submission authority.
 */
export function validateReportIndicators(indicators: IndicatorValues): ReportValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  for (const code of INDICATOR_CODES) {
    if (!isEnteredInteger(indicators[code])) errors.push(requiredError(code));
  }

  const addMaxError = (field: IndicatorCode, value: number | null, maximum: number | null) => {
    if (isEnteredInteger(value) && isEnteredInteger(maximum) && value > maximum) {
      errors.push({
        field,
        message: validationRules[field].error_message || `${field} vượt quá giá trị cho phép.`,
        severity: "error",
      });
    }
  };

  if (isEnteredInteger(indicators.CT01) && indicators.CT01 > 0 && isEnteredInteger(indicators.CT02)) {
    const ratio = indicators.CT02 / indicators.CT01;
    const minimum = validationRules.CT02.warning_multiplier_min;
    const maximum = validationRules.CT02.warning_multiplier_max;
    if (minimum !== undefined && maximum !== undefined && (ratio < minimum || ratio > maximum)) {
      warnings.push({
        field: "CT02",
        message: `${validationRules.CT02.warning_message} (Tỷ lệ hiện tại: ${ratio.toFixed(2)} lần)`,
        severity: "warning",
      });
    }
  }

  addMaxError("CT03", indicators.CT03, indicators.CT01);

  if (
    isEnteredInteger(indicators.CT01) &&
    isEnteredInteger(indicators.CT03) &&
    isEnteredInteger(indicators.CT04) &&
    indicators.CT03 + indicators.CT04 > indicators.CT01
  ) {
    errors.push({
      field: "CT04",
      message: validationRules.CT04.error_message || "CT03 và CT04 vượt quá CT01.",
      severity: "error",
    });
  }

  addMaxError("CT07", indicators.CT07, indicators.CT02);
  if (isEnteredInteger(indicators.CT02) && indicators.CT02 > 0 && isEnteredInteger(indicators.CT07)) {
    const ratio = indicators.CT07 / indicators.CT02;
    const minimum = validationRules.CT07.warning_ratio_min;
    const maximum = validationRules.CT07.warning_ratio_max;
    if (minimum !== undefined && maximum !== undefined && (ratio < minimum || ratio > maximum)) {
      warnings.push({
        field: "CT07",
        message: `Cảnh báo: tỷ lệ trẻ em dưới 16 tuổi là ${(ratio * 100).toFixed(1)}%; cần đối chiếu lại danh sách dân cư trước khi nộp.`,
        severity: "warning",
      });
    }
  }

  addMaxError("CT08", indicators.CT08, indicators.CT07);
  addMaxError("CT09", indicators.CT09, indicators.CT01);
  addMaxError("CT10", indicators.CT10, indicators.CT02);
  addMaxError("CT11", indicators.CT11, indicators.CT02);
  addMaxError("CT14", indicators.CT14, indicators.CT01);

  return { errors, warnings };
}
