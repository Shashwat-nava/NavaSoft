package video

import (
	"fmt"
	"image"
	"image/color"

	"gocv.io/x/gocv"

	"github.com/shashwatmani201/back/internal/analysis"
)

var (
	red   = color.RGBA{R: 255, G: 0, B: 0, A: 255}
	green = color.RGBA{R: 0, G: 255, B: 0, A: 255}
	black = color.RGBA{R: 0, G: 0, B: 0, A: 255}
	white = color.RGBA{R: 255, G: 255, B: 255, A: 255}
)

// colorFor returns Red for "head" and Green for everything else
func colorFor(label string) color.RGBA {
	if label == "head" {
		return red
	}
	return green
}

func DrawDetections(mat *gocv.Mat, detections []analysis.Detection, zones []analysis.Zone, width, height int) {
	drawZones(mat, zones, width, height)
	drawBoxes(mat, detections, width, height)
}

func drawZones(mat *gocv.Mat, zones []analysis.Zone, width, height int) {
	for _, zone := range zones {
		switch zone.Type {
		case "poly":
			if len(zone.Points) < 3 {
				continue
			}
			pts := make([]image.Point, len(zone.Points))
			for i, p := range zone.Points {
				pts[i] = image.Pt(int(p.X*float64(width)), int(p.Y*float64(height)))
			}

			overlay := mat.Clone()
			pv := gocv.NewPointsVectorFromPoints([][]image.Point{pts})
			gocv.FillPoly(&overlay, pv, color.RGBA{R: 0, G: 127, B: 255, A: 255})
			pv.Close()
			gocv.AddWeighted(overlay, 0.25, *mat, 0.75, 0, mat)
			overlay.Close()

			pv2 := gocv.NewPointsVectorFromPoints([][]image.Point{pts})
			gocv.Polylines(mat, pv2, true, color.RGBA{R: 0, G: 127, B: 255, A: 255}, 2)
			pv2.Close()

			if zone.Label != "" && len(pts) > 0 {
				gocv.PutText(mat, zone.Label, image.Pt(pts[0].X+4, pts[0].Y-8),
					gocv.FontHersheySimplex, 0.5, white, 1)
			}

		case "line":
			if len(zone.Points) != 2 {
				continue
			}
			a := image.Pt(int(zone.Points[0].X*float64(width)), int(zone.Points[0].Y*float64(height)))
			b := image.Pt(int(zone.Points[1].X*float64(width)), int(zone.Points[1].Y*float64(height)))
			gocv.Line(mat, a, b, red, 3)

			if zone.Label != "" {
				mid := image.Pt((a.X+b.X)/2, (a.Y+b.Y)/2-8)
				gocv.PutText(mat, zone.Label, mid,
					gocv.FontHersheySimplex, 0.5, white, 1)
			}
		}
	}
}

func drawBoxes(mat *gocv.Mat, detections []analysis.Detection, width, height int) {
	if len(detections) == 0 {
		return
	}

	overlay := mat.Clone()
	defer overlay.Close()

	for _, d := range detections {
		x, y, w, h := boxPixels(d.Box, width, height)
		c := colorFor(d.Label)
		gocv.Rectangle(&overlay, image.Rect(x, y, x+w, y+h), c, -1)
	}
	gocv.AddWeighted(overlay, 0.08, *mat, 0.92, 0, mat)

	for _, d := range detections {
		x, y, bw, bh := boxPixels(d.Box, width, height)
		c := colorFor(d.Label)

		// Main Box Border
		gocv.Rectangle(mat, image.Rect(x, y, x+bw, y+bh), c, 1)

		// Corner Brackets
		cornerLen := minInt(bw, bh) / 5
		cornerLen = clamp(cornerLen, 10, 40)
		drawCorners(mat, x, y, bw, bh, cornerLen, 3, c)

		// Label Badge (No ID number)
		drawLabel(mat, d, x, y, c)

		// Confidence bar
		drawConfBar(mat, d.Confidence, x, y+bh, bw, c)
	}
}

func boxPixels(box [4]float64, width, height int) (x, y, w, h int) {
	x = int(box[0] * float64(width))
	y = int(box[1] * float64(height))
	w = int(box[2] * float64(width))
	h = int(box[3] * float64(height))
	return
}

func drawCorners(mat *gocv.Mat, x, y, w, h, cLen, thick int, c color.RGBA) {
	gocv.Line(mat, image.Pt(x, y), image.Pt(x+cLen, y), c, thick)
	gocv.Line(mat, image.Pt(x, y), image.Pt(x, y+cLen), c, thick)
	gocv.Line(mat, image.Pt(x+w, y), image.Pt(x+w-cLen, y), c, thick)
	gocv.Line(mat, image.Pt(x+w, y), image.Pt(x+w, y+cLen), c, thick)
	gocv.Line(mat, image.Pt(x, y+h), image.Pt(x+cLen, y+h), c, thick)
	gocv.Line(mat, image.Pt(x, y+h), image.Pt(x, y+h-cLen), c, thick)
	gocv.Line(mat, image.Pt(x+w, y+h), image.Pt(x+w-cLen, y+h), c, thick)
	gocv.Line(mat, image.Pt(x+w, y+h), image.Pt(x+w, y+h-cLen), c, thick)
}

func drawLabel(mat *gocv.Mat, d analysis.Detection, x, y int, c color.RGBA) {
	const fontScale = 0.45
	const fontThick = 1
	const pad = 6

	// REMOVED TrackID logic: only using the label string now
	classText := d.Label
	confText := fmt.Sprintf(" %.0f%%", d.Confidence*100)

	classSz := gocv.GetTextSize(classText, gocv.FontHersheySimplex, fontScale, fontThick)
	confSz := gocv.GetTextSize(confText, gocv.FontHersheySimplex, fontScale*0.9, fontThick)

	badgeW := classSz.X + confSz.X + pad*3
	badgeH := maxInt(classSz.Y, confSz.Y) + pad*2 + 2

	bx, by := x, y-badgeH
	if by < 0 {
		by = y
	}

	// Label Background matches box color
	gocv.Rectangle(mat, image.Rect(bx, by, bx+badgeW, by+badgeH), c, -1)

	// Label Text (White for high contrast)
	textY := by + badgeH - pad
	gocv.PutText(mat, classText, image.Pt(bx+pad, textY), gocv.FontHersheySimplex, fontScale, white, fontThick)
	gocv.PutText(mat, confText, image.Pt(bx+pad+classSz.X+4, textY), gocv.FontHersheySimplex, fontScale*0.9, white, fontThick)
}

func drawConfBar(mat *gocv.Mat, confidence float64, x, y, bw int, c color.RGBA) {
	barH := 3
	fillW := int(confidence * float64(bw))
	if fillW < 1 {
		fillW = 1
	}
	gocv.Rectangle(mat, image.Rect(x, y+1, x+bw, y+1+barH), black, -1)
	gocv.Rectangle(mat, image.Rect(x, y+1, x+fillW, y+1+barH), c, -1)
}

func minInt(a, b int) int { if a < b { return a }; return b }
func maxInt(a, b int) int { if a > b { return a }; return b }
func clamp(v, lo, hi int) int { if v < lo { return lo }; if v > hi { return hi }; return v }