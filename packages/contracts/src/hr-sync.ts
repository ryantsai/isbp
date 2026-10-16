import { z } from 'zod';

/** SQL aliases are the source contract; the hub owns mappings, links, schedules and run history. */
export const hrDatabaseConfigSchema = z
  .object({
    databaseId: z.uuid(),
    employeesQuery: z.string().trim().min(1).max(20_000),
    departmentsQuery: z.string().trim().max(20_000).default(''),
    maxRows: z.number().int().min(1).max(20_000).default(5_000),
    syncStatus: z.boolean().default(true),
    activeValues: z.array(z.string().trim().min(1).max(100)).min(1).max(30).default(['active', 'employed']),
    leaverValues: z
      .array(z.string().trim().min(1).max(100))
      .min(1)
      .max(30)
      .default(['offboarded', 'terminated', 'left']),
  })
  .superRefine((value, ctx) => {
    const active = new Set(value.activeValues.map((v) => v.toLowerCase()));
    if (value.leaverValues.some((v) => active.has(v.toLowerCase())))
      ctx.addIssue({
        code: 'custom',
        path: ['leaverValues'],
        message: 'Active and leaver values must not overlap',
      });
  });
export type HrDatabaseConfig = z.output<typeof hrDatabaseConfigSchema>;

export const HR_EMPLOYEE_FIELDS = [
  'employeeId',
  'email',
  'username',
  'displayName',
  'givenName',
  'familyName',
  'jobTitle',
  'phone',
  'departmentCode',
  'managerId',
  'status',
] as const;
export const HR_DEPARTMENT_FIELDS = ['code', 'name', 'description', 'parentId'] as const;

export const HR_EMPLOYEES_SQL = `SELECT EmployeeId AS employeeId, Email AS email,
  LoginName AS username, FullName AS displayName,
  DepartmentCode AS departmentCode, ManagerEmployeeId AS managerId,
  EmploymentStatus AS status
FROM dbo.HrEmployees`;
export const HR_DEPARTMENTS_SQL = `SELECT DepartmentCode AS code, DepartmentName AS name,
  ParentDepartmentCode AS parentId
FROM dbo.HrDepartments`;
