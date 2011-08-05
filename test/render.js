var x11 = require('../lib/x11');

// adding XRender functions manually from
//     http://cgit.freedesktop.org/xcb/proto/tree/src/render.xml?id=HEAD
// and http://www.x.org/releases/X11R7.6/doc/renderproto/renderproto.txt
// TODO: move to templates
x11.createClient(
    function(display) {
        var X = display.client;
        X.QueryExtension('RENDER', function(ext) {          
            function RenderQueryVersion(clientMaj, clientMin, callback)
            {
                X.seq_num++;
                X.pack_stream.pack('CCSLL', [ext.majorOpcode, 0, 3, clientMaj, clientMin]);
                X.replies[X.seq_num] = [
                    function(buf, opt) {
                        var res = buf.unpack('LL');                 
                        return res;
                    },
                    callback
                ];
                X.pack_stream.flush();
            }

            function RenderQueryPictFormat(callback)
            {
                X.seq_num++;
                X.pack_stream.pack('CCS', [ext.majorOpcode, 1, 1]);
                X.replies[X.seq_num] = [
                    function (buf, opt) {
                        var res1 = buf.unpack('LLLLL');
                        // [ 28, 1, 7, 32, 0 ]
                        
                        console.log(res1); 
                        return res1;
                    },
                    callback
                ];
                X.pack_stream.flush();
            }
             
            function RenderQueryFilters(callback)
            {
                X.seq_num++;
                X.pack_stream.pack('CCSL', [ext.majorOpcode, 29, 2, display.screen[0].root]);
                X.replies[X.seq_num] = [
                    function(buf, opt) {
                        var h = buf.unpack('LL');                 
                        var num_aliases = h[0];
                        var num_filters = h[1];
                        var aliases = [];
                        var offset = 24; // LL + 16 bytes pad
                        for (var i=0; i < num_aliases; ++i)
                        {
                            aliases.push(buf.unpack('S', offset)[0]);
                            offset+=2;
                        }
                        var filters = [];
                        for (var i=0; i < num_filters; ++i)
                        {
                            var len = buf.unpack('C', offset)[0];
                            //if (!len) break;
                            offset++;
                            filters.push(buf.toString('ascii', offset, offset+len));
                            offset+=len;
                        }
                        return [aliases, filters];
                    },
                    callback
                ];
                X.pack_stream.flush();
            }
 
            var valueList = [ 
                ['repeat', 'C'],
                ['alphaMap', 'L'],
                ['alphaXOrigin', 's'],
                ['alphaYOrigin', 's'],
                ['clipMask', 'L'],
                ['graphicsExposures', 'C'],
                ['subwindowMode', 'C'],
                ['polyEdge', 'C'],
                ['polyMode', 'C'],
                ['dither', 'L'],
                ['componentAlpha', 'C']
            ];

            var argumentLength = {
                C: 1,
                S: 2,
                s: 2,
                L: 4,
                x: 1
            };

            function RenderCreatePicture(pid, drawable, pictformat, values)
            {
                X.seq_num++;
                var mask = 0;           
                var reqLen = 5; // + (values + pad)/4
                var format = 'CCSLLLL';
                var params = [ext.majorOpcode, 4, reqLen, pid, drawable, pictformat, mask];

                if (values)
                {
                    var valuesLength = 0;
                    for (var i=0; i < valueList.length; ++i)
                    {
                        var val = values[valueList[i][0]];
                        if (val) {
                            mask |= (1 << i);
                            params.push(val);
                            var valueFormat = valueList[i][1];
                            format += valueFormat;
                            valuesLength += argumentLength[valueFormat];
                        }
                    }
                    var pad4 = (valuesLength + 3) >> 2;
                    var toPad = (pad4 << 2) - valuesLength;
                    for (var i=0; i < toPad; ++i)
                        format += 'x';
                    reqLen += pad4;
                    params[2] = reqLen;
                    params[6] = mask;
                }
                console.log([format, params]);
                X.pack_stream.pack(format, params);
                X.pack_stream.flush();
            }

            function floatToFix(f)
            {
                return parseInt(f*65536);
            }

            function RenderLinearGradient(pid, p1, p2, stops)
            {
                X.seq_num++;
                var reqLen = 7+stops.length*3;  //header + params + 1xStopfix+2xColors
                var format = 'CCSLLLLLL';
                var params = [ext.majorOpcode, 34, reqLen, pid];
                params.push(floatToFix(p1[0])); // L
                params.push(floatToFix(p1[1]));
                params.push(floatToFix(p2[0]));
                params.push(floatToFix(p2[1])); // L

                params.push(stops.length);

                // [ [float stopDist, [float r, g, b, a] ], ...]
                // stop distances
                for (var i=0; i < stops.length; ++i)
                {
                    format += 'L';
                    // TODO: we know total params length in advance. ? params[index] = 
                    params.push(floatToFix(stops[i][0]))
                }
                // colors
                for (var i=0; i < stops.length; ++i)
                {
                    format += 'SSSS';
                    for (var j=0; j < 4; ++j)
                        params.push(stops[i][1][j]);
                }
		console.log([format, params]);
                X.pack_stream.pack(format, params);
                X.pack_stream.flush();                
            }

            function RenderFillRectangles(op, pid, color, rects)
            {
                X.seq_num++;
                var reqLen = 5+rects.length/2; 
                var format = 'CCSCxxxLSSSS';
                var params = [ext.majorOpcode, 26, reqLen, op, pid];
                for (var j=0; j < 4; ++j)
                    params.push(color[j]);
                for (var i=0; i < rects.length; i+=4)
                {
                    format += 'ssSS';
                    params.push(rects[i*4]);
                    params.push(rects[i*4 + 1]);
                    params.push(rects[i*4 + 2]);
                    params.push(rects[i*4 + 3]);
                }
		console.log([format, params]);
                X.pack_stream.pack(format, params);
                X.pack_stream.flush();                
            }

            function RenderComposite(op, src, mask, dst, srcX, srcY, maskX, maskY, dstX, dstY, width, height)
            {
                X.seq_num++;
                X.pack_stream.pack(
                    'CCSCxxxLLLssssssSS', 
                    [ext.majorOpcode, 8, 9, op, mask, dst, srcX, srcY, maskX, maskY, dstX, dstY, width, height]
                )
                .flush();
            }

            function RenderTriangles(op, src, srcX, srcY, dst, maskFormat, tris)
            {
                X.seq_num++;
                var format = 'CCSCxxxLLLss';
                //var format = 'CCSCxxxLLLSS';
                var params = [ext.majorOpcode, 11, 6+tris.length, op, src, dst, maskFormat, srcX, srcY];
                for (var i=0; i < tris.length; i+=6)                                   	
                {
                    format += 'llllll';
                    //format += 'LLLLLL';
                    //TODO: Array.copy
                    params.push(floatToFix(tris[i*6 + 0])); // x1
                    params.push(floatToFix(tris[i*6 + 1])); // y1
                    params.push(floatToFix(tris[i*6 + 2])); // x2
                    params.push(floatToFix(tris[i*6 + 3])); // y2
                    params.push(floatToFix(tris[i*6 + 4])); // x3
                    params.push(floatToFix(tris[i*6 + 5])); // y3
                }
		console.log([format, params]);
                X.pack_stream.pack(format, params);
                X.pack_stream.flush();                
            }

            var root = display.screen[0].root;
            var win = X.AllocID();
            var white = display.screen[0].white_pixel;
            var black = display.screen[0].black_pixel;
            X.CreateWindow(win, root, 0, 0, 300, 300, 4, 1, 0, { backgroundPixel: white, eventMask: x11.eventMask.Exposure });
            X.MapWindow(win);
            
            var picture = X.AllocID();
            RenderCreatePicture(picture, win, 71); //, { polyEdge: 1, polyMode: 0 } ); 
            var pixmap = X.AllocID();
            X.CreatePixmap(pixmap, win, 32, 1000, 1000);
            var pix_pict = X.AllocID();
            console.log(['!!!!!!!!!!!!!!!', picture, pixmap, pix_pict]);
            RenderCreatePicture(pix_pict, pixmap, 69); //, { polyEdge: 1, polyMode: 0 });
            RenderFillRectangles(1, pix_pict, [0xffff, 0, 0, 0x8000], [0, 0, 1000, 1000]);

            var pic_grad = X.AllocID();
            RenderLinearGradient(pic_grad, [0,0], [100,100], [ [0, [0,0,0,0xffff]], [100, [0xffff, 0xffff, 0xffff, 0xffff]]]);

            X.on('event', function(ev) {
                console.log(ev);
                RenderFillRectangles(1, picture, [0xffff, 0xffff, 0xffff, 0xffff], [0, 0, 500, 500]);
                //RenderFillRectangles(1, picture, [0xffff, 0xffff, 0x0000, 0xffff], [10, 10, 50, 50]);
                RenderTriangles(3, pix_pict, 500, 500, picture, 0, [250, 100, 100, 350, 400, 350]);
                //RenderTriangles(3, pic_grad, 500, 500, picture, 0, [250, 100, 100, 350, 400, 350]);
            });
        });
     }

).on('error', function(err) {
    console.log(['error! : ', err]);
});
