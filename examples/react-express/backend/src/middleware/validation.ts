import type { Request, Response, NextFunction } from "express";
import type { ZodType, ZodError } from "zod";

interface ValidationTarget {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

interface ValidationErrorDetail {
  field: string;
  message: string;
}

function formatZodError(error: ZodError): ValidationErrorDetail[] {
  return error.issues.map((issue) => ({
    field: issue.path.join(".") || "(root)",
    message: issue.message,
  }));
}

export function validate(schema: ValidationTarget) {
  return (req: Request, res: Response, next: NextFunction) => {
    const errors: ValidationErrorDetail[] = [];

    if (schema.body) {
      const result = schema.body.safeParse(req.body);
      if (!result.success) {
        errors.push(...formatZodError(result.error));
      } else {
        req.body = result.data;
      }
    }

    if (schema.query) {
      const result = schema.query.safeParse(req.query);
      if (!result.success) {
        errors.push(...formatZodError(result.error));
      } else {
        // Merge parsed query back (applies defaults like store=kv)
        Object.assign(req.query, result.data);
      }
    }

    if (schema.params) {
      const result = schema.params.safeParse(req.params);
      if (!result.success) {
        errors.push(...formatZodError(result.error));
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: "validation_error",
        message: "Request validation failed",
        details: errors,
      });
    }

    next();
  };
}
