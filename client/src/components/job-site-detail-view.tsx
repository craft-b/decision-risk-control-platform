// client/src/components/job-site-detail-view.tsx

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, User, Phone, Calendar, Package } from "lucide-react";
import { format } from "date-fns";

type JobSiteDetailViewProps = {
  jobSite: any;
};

export function JobSiteDetailView({ jobSite }: JobSiteDetailViewProps) {
  if (!jobSite) {
    return <div className="text-center py-12 text-muted-foreground">Job site not found</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-2xl font-bold">{jobSite.name}</h3>
        <p className="text-sm text-muted-foreground font-mono">{jobSite.jobId}</p>
      </div>

      {/* Location */}
      {jobSite.address && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Location</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{jobSite.address}</p>
          </CardContent>
        </Card>
      )}

      {/* Contact Information */}
      {(jobSite.contactPerson || jobSite.contactPhone) && (
        <Card>
          <CardHeader>
            <CardTitle>Contact Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {jobSite.contactPerson && (
              <div className="flex items-center gap-3">
                <User className="h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="text-sm text-muted-foreground">Contact Person</div>
                  <div className="font-medium">{jobSite.contactPerson}</div>
                </div>
              </div>
            )}
            {jobSite.contactPhone && (
              <div className="flex items-center gap-3">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="text-sm text-muted-foreground">Phone Number</div>
                  <div className="font-medium">{jobSite.contactPhone}</div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Statistics */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Usage Statistics</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Total Rentals</span>
            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
              {jobSite._count?.rentals || 0} rentals
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* System Info */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-muted-foreground" />
            <CardTitle>System Information</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Created</span>
              <span className="font-medium">
                {jobSite.createdAt ? format(new Date(jobSite.createdAt), 'MMM d, yyyy') : 'N/A'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Job ID</span>
              <span className="font-mono font-medium">{jobSite.jobId}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// client/src/components/vendor-detail-view.tsx

export function VendorDetailView({ vendor }: { vendor: any }) {
  if (!vendor) {
    return <div className="text-center py-12 text-muted-foreground">Vendor not found</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-2xl font-bold">{vendor.name}</h3>
        <p className="text-sm text-muted-foreground font-mono">{vendor.vendorId}</p>
      </div>

      {/* Location */}
      {vendor.address && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Address</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{vendor.address}</p>
          </CardContent>
        </Card>
      )}

      {/* Contact Information */}
      {(vendor.salesPerson || vendor.contact) && (
        <Card>
          <CardHeader>
            <CardTitle>Contact Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {vendor.salesPerson && (
              <div className="flex items-center gap-3">
                <User className="h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="text-sm text-muted-foreground">Sales Person</div>
                  <div className="font-medium">{vendor.salesPerson}</div>
                </div>
              </div>
            )}
            {vendor.contact && (
              <div className="flex items-center gap-3">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="text-sm text-muted-foreground">Contact</div>
                  <div className="font-medium">{vendor.contact}</div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Statistics */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Business Statistics</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Total Rentals</span>
            <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
              {vendor._count?.rentals || 0} rentals
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* System Info */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-muted-foreground" />
            <CardTitle>System Information</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Added</span>
              <span className="font-medium">
                {vendor.createdAt ? format(new Date(vendor.createdAt), 'MMM d, yyyy') : 'N/A'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Vendor ID</span>
              <span className="font-mono font-medium">{vendor.vendorId}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}