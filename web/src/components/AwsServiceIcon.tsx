/**
 * AWS service icons for the TF Diagram view.
 *
 * Stylized after the AWS Architecture Icons system:
 *   - 24x24 rounded square tile in the official AWS category color
 *   - white glyph centered, evoking the standard product mark
 *   - color taken from the AWS palette (squid-ink / orange / sky-blue / mint)
 *
 * Inline SVG (no asset downloads, no licensing dance) keeps the diagram
 * exportable to PNG/SVG without external fetches.
 */

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

/** AWS category → tile background. Eight well-separated hues so resources of
 *  different services are instantly distinguishable (the whole point of an
 *  architecture diagram), loosely following the AWS Architecture Icons palette. */
const CATEGORY_COLOR: Record<string, string> = {
  network: "#8C4FFF",     // Networking & Content Delivery (violet)
  compute: "#ED7100",     // Compute (orange)
  container: "#0891B2",   // Containers (cyan)
  storage: "#16A34A",     // Storage (green)
  data: "#2563EB",        // Database (blue)
  security: "#DC2626",    // Security, Identity & Compliance (red)
  management: "#DB2777",  // Management & Governance (pink)
  integration: "#CA8A04", // Application Integration (amber)
};

const TYPE_TO_CATEGORY: Record<string, keyof typeof CATEGORY_COLOR> = {
  // Network
  aws_vpc: "network",
  aws_subnet: "network",
  aws_route_table: "network",
  aws_internet_gateway: "network",
  aws_nat_gateway: "network",
  aws_lb: "network",
  aws_lb_listener: "network",
  aws_lb_target_group: "network",
  aws_route53_zone: "network",
  aws_route53_record: "network",
  aws_cloudfront_distribution: "network",
  aws_api_gateway_rest_api: "network",
  aws_apigatewayv2_api: "network",
  // Compute
  aws_instance: "compute",
  aws_lambda_function: "compute",
  aws_autoscaling_group: "compute",
  aws_launch_template: "compute",
  // Containers
  aws_ecs_cluster: "container",
  aws_ecs_service: "container",
  aws_ecs_task_definition: "container",
  aws_ecr_repository: "container",
  aws_eks_cluster: "container",
  // Storage
  aws_ebs_volume: "storage",
  aws_s3_bucket: "storage",
  aws_efs_file_system: "storage",
  // Database
  aws_db_instance: "data",
  aws_rds_cluster: "data",
  aws_dynamodb_table: "data",
  aws_elasticache_cluster: "data",
  // Security / Identity
  aws_security_group: "security",
  aws_iam_role: "security",
  aws_iam_policy: "security",
  aws_iam_user: "security",
  aws_kms_key: "security",
  aws_acm_certificate: "security",
  aws_secretsmanager_secret: "security",
  aws_wafv2_web_acl: "security",
  // Management & Governance
  aws_cloudwatch_log_group: "management",
  aws_cloudwatch_metric_alarm: "management",
  aws_appautoscaling_target: "management",
  aws_appautoscaling_policy: "management",
  aws_cloudwatch_dashboard: "management",
  // Application Integration
  aws_sns_topic: "integration",
  aws_sqs_queue: "integration",
  aws_sfn_state_machine: "integration",
  aws_eventbridge_rule: "integration",
  aws_cloudwatch_event_rule: "integration",
};

/** Short, AWS-style label that goes under the icon in the diagram. */
export const TYPE_TO_LABEL: Record<string, string> = {
  aws_vpc: "VPC",
  aws_subnet: "Subnet",
  aws_security_group: "Security Group",
  aws_route_table: "Route Table",
  aws_internet_gateway: "Internet Gateway",
  aws_nat_gateway: "NAT Gateway",
  aws_lb: "Load Balancer",
  aws_lb_listener: "LB Listener",
  aws_lb_target_group: "Target Group",
  aws_route53_zone: "Route 53 Zone",
  aws_cloudfront_distribution: "CloudFront",
  aws_api_gateway_rest_api: "API Gateway",
  aws_instance: "EC2",
  aws_lambda_function: "Lambda",
  aws_autoscaling_group: "Auto Scaling Group",
  aws_ecs_cluster: "ECS Cluster",
  aws_ecs_service: "ECS Service",
  aws_ecs_task_definition: "ECS Task Def",
  aws_ecr_repository: "ECR",
  aws_eks_cluster: "EKS",
  aws_ebs_volume: "EBS",
  aws_s3_bucket: "S3",
  aws_efs_file_system: "EFS",
  aws_db_instance: "RDS",
  aws_rds_cluster: "RDS Cluster",
  aws_dynamodb_table: "DynamoDB",
  aws_elasticache_cluster: "ElastiCache",
  aws_iam_role: "IAM Role",
  aws_iam_policy: "IAM Policy",
  aws_iam_user: "IAM User",
  aws_kms_key: "KMS Key",
  aws_acm_certificate: "ACM Certificate",
  aws_secretsmanager_secret: "Secrets Manager",
  aws_cloudwatch_log_group: "CloudWatch Logs",
  aws_cloudwatch_metric_alarm: "CloudWatch Alarm",
  aws_appautoscaling_target: "App Auto Scaling",
  aws_appautoscaling_policy: "Scaling Policy",
  aws_sns_topic: "SNS Topic",
  aws_sqs_queue: "SQS Queue",
  aws_sfn_state_machine: "Step Functions",
};

/** Per-resource glyph drawn in white on top of the tile. Coordinates are
 * inside a 24×24 viewBox; keep strokes ≥ 1.5 for legibility at small sizes. */
const GLYPHS: Record<string, JSX.Element> = {
  aws_vpc: (
    <path
      d="M4 6h16v12H4z M4 10h16 M8 6v12 M16 6v12"
      stroke="currentColor"
      strokeWidth="1.5"
      fill="none"
    />
  ),
  aws_subnet: (
    <path
      d="M5 7h14v10H5z"
      stroke="currentColor"
      strokeWidth="1.5"
      fill="none"
      strokeDasharray="2 2"
    />
  ),
  aws_security_group: (
    <path
      d="M12 4l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V7l7-3z"
      stroke="currentColor"
      strokeWidth="1.5"
      fill="none"
    />
  ),
  aws_route_table: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none">
      <path d="M4 8h16 M4 12h16 M4 16h16" />
      <circle cx="7" cy="8" r="1.2" fill="currentColor" />
      <circle cx="17" cy="12" r="1.2" fill="currentColor" />
      <circle cx="10" cy="16" r="1.2" fill="currentColor" />
    </g>
  ),
  aws_internet_gateway: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none">
      <circle cx="12" cy="12" r="7" />
      <path d="M5 12h14 M12 5c2.5 3 2.5 11 0 14 M12 5c-2.5 3-2.5 11 0 14" />
    </g>
  ),
  aws_nat_gateway: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none">
      <path d="M6 18l6-12 6 12z" />
      <path d="M9 14h6" />
    </g>
  ),
  aws_lb: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none">
      <circle cx="12" cy="6" r="2" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="12" cy="18" r="2" />
      <circle cx="18" cy="18" r="2" />
      <path d="M12 8v3 M12 11l-6 5 M12 11l6 5 M12 11v5" />
    </g>
  ),
  aws_lb_target_group: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none">
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    </g>
  ),
  aws_instance: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none">
      <path d="M5 6h14v12H5z" />
      <path d="M8 9h8v6H8z" />
      <path d="M3 9h2 M3 12h2 M3 15h2 M19 9h2 M19 12h2 M19 15h2" />
    </g>
  ),
  aws_lambda_function: (
    <path
      d="M7 4h4l8 16h-4L9 8 5 20H4z"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
  ),
  aws_ebs_volume: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none">
      <ellipse cx="12" cy="6.5" rx="7" ry="2.5" />
      <path d="M5 6.5v11c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-11" />
      <path d="M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" />
    </g>
  ),
  aws_s3_bucket: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none">
      <path d="M6 6h12l-1 14H7z" />
      <path d="M6 9h12" />
    </g>
  ),
  aws_db_instance: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none">
      <ellipse cx="12" cy="6.5" rx="7" ry="2.5" />
      <path d="M5 6.5v11c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-11" />
      <path d="M5 10c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5 M5 14c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" />
    </g>
  ),
  aws_lb_listener: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none">
      <path d="M5 12h4l3-5v10l-3-5" />
      <path d="M14 9c1.5 1 1.5 5 0 6 M16.5 7c2.5 2 2.5 8 0 10" strokeLinecap="round" />
    </g>
  ),
  aws_route53_zone: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none">
      <circle cx="12" cy="12" r="7.5" />
      <path d="M4.5 12h15 M12 4.5c2.4 2.6 2.4 12.4 0 15 M12 4.5c-2.4 2.6-2.4 12.4 0 15" />
    </g>
  ),
  aws_ecs_cluster: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none">
      <path d="M4 5h7v7H4z M13 12h7v7h-7z M4 14h7v5H4z M13 5h7v5h-7z" />
    </g>
  ),
  aws_ecs_service: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none">
      <rect x="4" y="7" width="9" height="10" rx="1" />
      <rect x="8" y="9" width="9" height="10" rx="1" fill="currentColor" fillOpacity="0.25" />
      <rect x="11" y="5" width="9" height="10" rx="1" />
    </g>
  ),
  aws_ecs_task_definition: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none">
      <path d="M6 4h8l4 4v12H6z" />
      <path d="M14 4v4h4" />
      <rect x="9" y="12" width="6" height="5" rx="0.8" />
    </g>
  ),
  aws_ecr_repository: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none">
      <path d="M5 8l7-3 7 3-7 3z" />
      <path d="M5 8v8l7 3 7-3V8 M12 11v8" />
    </g>
  ),
  aws_iam_role: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none">
      <circle cx="9" cy="9" r="3" />
      <path d="M4 19c0-3 2.2-5 5-5 1.2 0 2.3.4 3.2 1" />
      <circle cx="16.5" cy="14.5" r="2" />
      <path d="M16.5 16.5v3 M15 18l-1.5 1 M18 18l1.5 1" strokeLinecap="round" />
    </g>
  ),
  aws_iam_policy: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none">
      <path d="M6 4h8l4 4v12H6z" />
      <path d="M14 4v4h4" />
      <path d="M8.5 13l2 2 3.5-4" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  ),
  aws_kms_key: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none">
      <circle cx="8.5" cy="8.5" r="3.5" />
      <path d="M11 11l7 7 M15 15l2-2 M17 17l2-2" strokeLinecap="round" />
    </g>
  ),
  aws_acm_certificate: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none">
      <circle cx="12" cy="9" r="5" />
      <path d="M9.5 8.5l1.8 1.8 3-3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 13l-1.5 7 4.5-2.5 4.5 2.5-1.5-7" />
    </g>
  ),
  aws_cloudwatch_log_group: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none">
      <rect x="5" y="4" width="14" height="16" rx="1.5" />
      <path d="M8 8h8 M8 11h8 M8 14h5" strokeLinecap="round" />
    </g>
  ),
  aws_cloudwatch_metric_alarm: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none">
      <path d="M6 16c0-5 2-8 6-8s6 3 6 8z" />
      <path d="M4.5 16h15" strokeLinecap="round" />
      <path d="M10.5 19a1.6 1.6 0 003 0" />
      <path d="M12 5v3" strokeLinecap="round" />
    </g>
  ),
  aws_appautoscaling_target: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none">
      <rect x="9" y="9" width="6" height="6" rx="1" />
      <path d="M5 5l2.5 2.5 M5 5v3 M5 5h3 M19 5l-2.5 2.5 M19 5v3 M19 5h-3 M5 19l2.5-2.5 M5 19v-3 M5 19h3 M19 19l-2.5-2.5 M19 19v-3 M19 19h-3" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  ),
  aws_appautoscaling_policy: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none">
      <path d="M7 15V8l-2 2 M7 8l2 2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 9v7l2-2 M17 16l-2-2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 12h2" strokeLinecap="round" />
    </g>
  ),
  aws_sns_topic: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none">
      <path d="M5 10v4l5 3V7z" />
      <path d="M13 9c1.5 1 1.5 5 0 6 M15.5 7c2.5 2 2.5 8 0 10" strokeLinecap="round" />
    </g>
  ),
  aws_sqs_queue: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none">
      <rect x="4" y="8" width="4" height="8" rx="1" />
      <rect x="10" y="8" width="4" height="8" rx="1" />
      <rect x="16" y="8" width="4" height="8" rx="1" />
    </g>
  ),
  aws_dynamodb_table: (
    <g stroke="currentColor" strokeWidth="1.5" fill="none">
      <rect x="4" y="5" width="16" height="14" rx="1.5" />
      <path d="M4 9h16 M4 13h16 M10 5v14" />
    </g>
  ),
};

const FALLBACK_GLYPH = (
  <path
    d="M6 6h12v12H6z M9 10h6 M9 13h6"
    stroke="currentColor"
    strokeWidth="1.5"
    fill="none"
  />
);

export function awsCategoryColor(type: string): string {
  return CATEGORY_COLOR[TYPE_TO_CATEGORY[type] ?? "network"];
}

/** Category key for a tf type ("network", "compute", "container", …); types we
 *  don't classify fall into "other". */
export function awsCategory(type: string): string {
  return TYPE_TO_CATEGORY[type] ?? "other";
}

/** Display labels for the category chips. */
export const CATEGORY_LABEL: Record<string, string> = {
  network: "Network",
  compute: "Compute",
  container: "Containers",
  storage: "Storage",
  data: "Database",
  security: "Security",
  management: "Monitoring",
  integration: "Integration",
  other: "Other",
};

/** Human label for any tf type. Known types use the curated map; unknown ones
 *  (aws_iam_role → "IAM Role", aws_ecs_service → "ECS Service") get a tidy
 *  derived label so the diagram reads well beyond the 13-type catalog. */
export function prettyTypeLabel(type: string): string {
  if (TYPE_TO_LABEL[type]) return TYPE_TO_LABEL[type];
  const stripped = type.replace(/^data\.aws_/, "").replace(/^aws_/, "");
  if (!stripped) return type;
  return stripped
    .split("_")
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

export function AwsServiceIcon({ type, size = 28, ...rest }: IconProps & { type: string }) {
  const bg = awsCategoryColor(type);
  const glyph = GLYPHS[type] ?? FALLBACK_GLYPH;
  // The white glyph rides on top of the colored tile; rounded corners match
  // the AWS Architecture Icons spec (≈ 15% of side length).
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={prettyTypeLabel(type)}
      {...rest}
    >
      <rect x="0" y="0" width="24" height="24" rx="4" ry="4" fill={bg} />
      <g color="#FFFFFF">{glyph}</g>
    </svg>
  );
}
