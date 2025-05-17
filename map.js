import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Set Mapbox access token
mapboxgl.accessToken = 'pk.eyJ1Ijoicml0dmlrY2hhbmQiLCJhIjoiY204b3Y3bnliMDRoMjJrbXpjeXozNjdjeiJ9.EHfEtBoIx7l1TOKrB9IObA';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});


let timeFilter = -1;

let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

function getCoords(station) {
    const point = new mapboxgl.LngLat(+station.lon, +station.lat);
    const { x, y } = map.project(point);
    return { cx: x, cy: y };
}

function formatTime(minutes) {
    const date = new Date(0, 0, 0, 0, minutes);
    return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function minutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
}

function filterByMinute(tripsByMinute, minute) {
    if (minute === -1) {
        return tripsByMinute.flat(); 
    }
    let minMinute = (minute - 60 + 1440) % 1440;
    let maxMinute = (minute + 60) % 1440;
    if (minMinute > maxMinute) {
        let beforeMidnight = tripsByMinute.slice(minMinute);
        let afterMidnight = tripsByMinute.slice(0, maxMinute + 1);
        return beforeMidnight.concat(afterMidnight).flat();
    } else {
        return tripsByMinute.slice(minMinute, maxMinute + 1).flat();
    }
}

function computeStationTraffic(stations, timeFilter = -1) {
    const departures = d3.rollup(
        filterByMinute(departuresByMinute, timeFilter),
        (v) => v.length,
        (d) => d.start_station_id
    );

    const arrivals = d3.rollup(
        filterByMinute(arrivalsByMinute, timeFilter),
        (v) => v.length,
        (d) => d.end_station_id
    );

    return stations.map((station) => {
        let id = station.short_name;
        station.arrivals = arrivals.get(id) ?? 0;
        station.departures = departures.get(id) ?? 0;
        station.totalTraffic = station.arrivals + station.departures;
        return station;
    });
}

map.on('load', async () => {
    map.addSource('boston_route', {
        type: 'geojson',
        data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
    });

    map.addLayer({
        id: 'bike-lanes',
        type: 'line',
        source: 'boston_route',
        paint: {
            'line-color': '#32D400',
            'line-width': 5,
            'line-opacity': 0.6
        },
    });

    map.addSource('cambridge_route', {
        type: 'geojson',
        data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
    });

    map.addLayer({
        id: 'bike-lanes2',
        type: 'line',
        source: 'cambridge_route',
        paint: {
            'line-color': '#b77ef7',
            'line-width': 5,
            'line-opacity': 0.6,
        },
    });
    
    let jsonData;
    let trips;
    
    try {
        const jsonurl = "https://dsc106.com/labs/lab07/data/bluebikes-stations.json";
        const tripsurl = "https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv"

        jsonData = await d3.json(jsonurl);
        
        trips = await d3.csv(
            tripsurl,
            (trip) => {
                trip.started_at = new Date(trip.started_at);
                trip.ended_at = new Date(trip.ended_at);
                
                const startedMinutes = minutesSinceMidnight(trip.started_at);
                const endedMinutes = minutesSinceMidnight(trip.ended_at);
                
                departuresByMinute[startedMinutes].push(trip);
                arrivalsByMinute[endedMinutes].push(trip);
                
                return trip;
            }
        );
    } catch (error) {
        console.error('Error loading data:', error);
    }
    let stations = computeStationTraffic(jsonData.data.stations);

    const svg = d3.select('#map').select('svg');

    const radiusScale = d3
        .scaleSqrt()
        .domain([0, d3.max(stations, (d) => d.totalTraffic)])
        .range([0, 25]);

    const circles = svg
        .selectAll('circle')
        .data(stations, (d) => d.short_name)
        .enter()
        .append('circle')
        .attr('r', d => radiusScale(d.totalTraffic))
        .attr('fill', 'steelblue')
        .attr('stroke', 'white')
        .attr('stroke-width', 1)
        .attr('opacity', 0.6)
        .each(function (d) {
            d3.select(this)
              .append('title')
              .text(
                `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
              );
        });
        
    function updatePositions() {
        circles
            .attr('cx', (d) => getCoords(d).cx)
            .attr('cy', (d) => getCoords(d).cy);
    }
  
    updatePositions();

    map.on('move', updatePositions);
    map.on('zoom', updatePositions);
    map.on('resize', updatePositions);
    map.on('moveend', updatePositions);

    const timeSlider = document.getElementById('timeSlider');
    const selectedTime = document.getElementById('selected-time');
    const anyTimeLabel = document.getElementById('any-time');

    function updateScatterPlot(timeFilter) {
        const filteredStations = computeStationTraffic(jsonData.data.stations, timeFilter);

        timeFilter === -1 
            ? radiusScale.range([0, 25]) 
            : radiusScale.range([3, 50]);
            
        const maxTraffic = d3.max(filteredStations, (d) => d.totalTraffic) || 1;
        radiusScale.domain([0, maxTraffic]);

        const updatedCircles = svg
            .selectAll('circle')
            .data(filteredStations, (d) => d.short_name);
            
        updatedCircles
            .transition()
            .duration(300)
            .attr('r', (d) => radiusScale(d.totalTraffic))
            .each(function (d) {
                d3.select(this).select('title')
                    .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
            });
            
        updatedCircles.enter()
            .append('circle')
            .attr('r', 0)
            .attr('fill', 'steelblue')
            .attr('stroke', 'white')
            .attr('stroke-width', 1)
            .attr('opacity', 0.6)
            .transition()
            .duration(300)
            .attr('r', (d) => radiusScale(d.totalTraffic))
            .each(function (d) {
                d3.select(this)
                  .append('title')
                  .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
            });
            
        updatedCircles.exit()
            .transition()
            .duration(300)
            .attr('r', 0)
            .remove();
        
        updatePositions();
    }

    function updateTimeDisplay() {
        if (!timeSlider) return;
        
        timeFilter = Number(timeSlider.value);

        if (selectedTime) {
            if (timeFilter === -1) {
                selectedTime.textContent = '';
                if (anyTimeLabel) anyTimeLabel.style.display = 'block';
            } else {
                selectedTime.textContent = formatTime(timeFilter);
                if (anyTimeLabel) anyTimeLabel.style.display = 'none';
            }
        }

        updateScatterPlot(timeFilter);
    }

    if (timeSlider) {
        timeSlider.addEventListener('input', updateTimeDisplay);
        updateTimeDisplay();
    }
});