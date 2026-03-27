package analysis

import (
	"math"
)

type Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type Zone struct {
	Type   string  `json:"type"`
	Points []Point `json:"points"`
	Label  string  `json:"label"`
	Color  string  `json:"color"`
}

type Detection struct {
	Label      string     `json:"label"`
	Confidence float64    `json:"confidence"`
	Box        [4]float64 `json:"box"`
	TrackID    int        `json:"trackId"`
	InZone     bool       `json:"inZone"`
}

type FrameMetrics struct {
	NearMiss      bool
	Exposure      bool
	ZoneViolation bool
	PPECompliant  bool
}

func PointInPolygon(pt Point, poly []Point) bool {
	// ray casting
	inside := false
	for i, j := 0, len(poly)-1; i < len(poly); j, i = i, i+1 {
		if ((poly[i].Y > pt.Y) != (poly[j].Y > pt.Y)) &&
			(pt.X < (poly[j].X-poly[i].X)*(pt.Y-poly[i].Y)/(poly[j].Y-poly[i].Y)+poly[i].X) {
			inside = !inside
		}
	}
	return inside
}

func PointLineDistance(pt, a, b Point) float64 {
	abx := b.X - a.X
	aby := b.Y - a.Y
	t := ((pt.X-a.X)*abx + (pt.Y-a.Y)*aby) / (abx*abx + aby*aby)
	if t < 0 {
		t = 0
	}
	if t > 1 {
		t = 1
	}
	nearestX := a.X + t*abx
	nearestY := a.Y + t*aby
	return math.Hypot(pt.X-nearestX, pt.Y-nearestY)
}

func CheckZone(d *Detection, zones []Zone, width, height int) {
	if len(zones) == 0 {
		d.InZone = false
		return
	}
	cx := (d.Box[0] + d.Box[2]/2) * float64(width)
	cy := (d.Box[1] + d.Box[3]/2) * float64(height)
	pt := Point{X: cx, Y: cy}
	for _, zone := range zones {
		switch zone.Type {
		case "poly":
			if len(zone.Points) < 3 {
				continue
			}
			polyAbs := make([]Point, len(zone.Points))
			for i, p := range zone.Points {
				polyAbs[i] = Point{X: p.X * float64(width), Y: p.Y * float64(height)}
			}
			if PointInPolygon(pt, polyAbs) {
				d.InZone = true
				return
			}
		case "line":
			if len(zone.Points) != 2 {
				continue
			}
			a := Point{X: zone.Points[0].X * float64(width), Y: zone.Points[0].Y * float64(height)}
			b := Point{X: zone.Points[1].X * float64(width), Y: zone.Points[1].Y * float64(height)}
			if PointLineDistance(pt, a, b) < 50 { // threshold 50 pixels
				d.InZone = true
				return
			}
		}
	}
}

func AnalyzeFrame(detections []Detection, zones []Zone, width, height int) FrameMetrics {
	workers := []*Detection{}
	forklifts := []*Detection{}
	helmets := []*Detection{}

	for i := range detections {
		d := &detections[i]
		switch d.Label {
		case "person":
			workers = append(workers, d)
		case "forklift":
			forklifts = append(forklifts, d)
		case "helmet":
			helmets = append(helmets, d)
		}
	}

	// Zone violations
	zoneViolation := false
	for _, w := range workers {
		CheckZone(w, zones, width, height)
		if w.InZone {
			zoneViolation = true
		}
	}

	// Near-miss and exposure
	nearMiss := false
	exposure := false
	const PROX_PX = 120.0
	for _, w := range workers {
		for _, f := range forklifts {
			wcx := (w.Box[0] + w.Box[2]/2) * float64(width)
			wcy := (w.Box[1] + w.Box[3]/2) * float64(height)
			fcx := (f.Box[0] + f.Box[2]/2) * float64(width)
			fcy := (f.Box[1] + f.Box[3]/2) * float64(height)
			dist := math.Hypot(wcx-fcx, wcy-fcy)
			if dist < PROX_PX {
				nearMiss = true
				exposure = true
			} else if dist < PROX_PX*2.5 {
				exposure = true
			}
		}
	}

	// PPE compliance
	ppeCompliant := false
	if len(workers) > 0 {
		ppeCompliant = len(helmets) >= len(workers)
	}

	return FrameMetrics{
		NearMiss:      nearMiss,
		Exposure:      exposure,
		ZoneViolation: zoneViolation,
		PPECompliant:  ppeCompliant,
	}
}