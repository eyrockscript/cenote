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

/** AWS category → tile background. Matches the official Architecture Icons palette. */
const CATEGORY_COLOR: Record<string, string> = {
  network: "#8C4FFF",   // Networking & Content Delivery (purple)
  compute: "#ED7100",   // Compute (orange)
  storage: "#7AA116",   // Storage (green)
  data: "#3334B9",      // Database (blue)
  security: "#DD344C",  // Security, Identity, & Compliance (red)
};

const TYPE_TO_CATEGORY: Record<string, keyof typeof CATEGORY_COLOR> = {
  aws_vpc: "network",
  aws_subnet: "network",
  aws_security_group: "security",
  aws_route_table: "network",
  aws_internet_gateway: "network",
  aws_nat_gateway: "network",
  aws_lb: "network",
  aws_lb_target_group: "network",
  aws_instance: "compute",
  aws_lambda_function: "compute",
  aws_ebs_volume: "storage",
  aws_s3_bucket: "storage",
  aws_db_instance: "data",
};

/** Short, AWS-style label that goes under the icon in the diagram. */
export const TYPE_TO_LABEL: Record<string, string> = {
  aws_vpc: "VPC",
  aws_subnet: "Subnet",
  aws_security_group: "Security Group",
  aws_route_table: "Route Table",
  aws_internet_gateway: "Internet Gateway",
  aws_nat_gateway: "NAT Gateway",
  aws_lb: "Elastic Load Balancing",
  aws_lb_target_group: "Target Group",
  aws_instance: "EC2",
  aws_lambda_function: "Lambda",
  aws_ebs_volume: "EBS",
  aws_s3_bucket: "S3",
  aws_db_instance: "RDS",
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
      aria-label={TYPE_TO_LABEL[type] ?? type}
      {...rest}
    >
      <rect x="0" y="0" width="24" height="24" rx="4" ry="4" fill={bg} />
      <g color="#FFFFFF">{glyph}</g>
    </svg>
  );
}
